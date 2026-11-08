// Package immich contains the Immich connector: an HTTP client for the
// Immich API (v3) and the connector Kind for the type "immich".
package immich

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const (
	// requestTimeout limits one Immich request including reading the body.
	requestTimeout = 30 * time.Second
	// assetPageSize is the number of assets per AlbumAssets page.
	assetPageSize = 250
	// maxJSONResponse limits the size of a JSON response from Immich.
	maxJSONResponse = 32 << 20 // 32 MiB
	// apiKeyHeader is the Immich API key header.
	apiKeyHeader = "x-api-key"
)

// StatusError is returned for an Immich response with a non-2xx status.
type StatusError struct {
	Method     string
	Path       string
	StatusCode int
}

// Error implements the error interface. The message is safe to show to the
// user (it contains no API key).
func (e *StatusError) Error() string {
	if e.StatusCode == http.StatusUnauthorized || e.StatusCode == http.StatusForbidden {
		return fmt.Sprintf("Immich rejected the request: invalid API key or missing permission (HTTP %d)", e.StatusCode)
	}
	return fmt.Sprintf("Immich request %s %s failed with HTTP %d", e.Method, e.Path, e.StatusCode)
}

// Client calls the Immich API of one server with one API key. It is safe for
// concurrent use. The API key is only sent in the x-api-key header and is
// never part of an error message.
type Client struct {
	apiURL string // server URL + "/api", no trailing slash
	apiKey string
	http   *http.Client
}

// NewClient returns a client for the Immich server at serverURL (e.g.
// "https://immich.example.com"; a trailing slash is removed and "/api" is
// appended). httpClient may be nil; then NewHTTPClient is used.
func NewClient(serverURL, apiKey string, httpClient *http.Client) *Client {
	if httpClient == nil {
		httpClient = NewHTTPClient()
	}
	return &Client{
		apiURL: strings.TrimRight(serverURL, "/") + "/api",
		apiKey: apiKey,
		http:   httpClient,
	}
}

// NewHTTPClient returns the HTTP client for Immich requests: 30 s timeout,
// and redirects only to the same host (the API key header must not be sent
// to another host).
func NewHTTPClient() *http.Client {
	return &http.Client{
		Timeout:       requestTimeout,
		CheckRedirect: sameHostRedirectsOnly,
	}
}

func sameHostRedirectsOnly(req *http.Request, via []*http.Request) error {
	if len(via) >= 10 {
		return errors.New("stopped after 10 redirects")
	}
	if req.URL.Host != via[0].URL.Host {
		return fmt.Errorf("redirect to another host (%s) is not allowed", req.URL.Host)
	}
	return nil
}

// ServerVersion returns the version of the server. This call needs no API
// key.
func (c *Client) ServerVersion(ctx context.Context) (ServerVersion, error) {
	var v ServerVersion
	err := c.doJSON(ctx, http.MethodGet, "/server/version", nil, &v)
	return v, err
}

// ListAlbums returns all albums the API key can see (own and shared).
// Needs the permission album.read.
func (c *Client) ListAlbums(ctx context.Context) ([]Album, error) {
	var albums []Album
	if err := c.doJSON(ctx, http.MethodGet, "/albums", nil, &albums); err != nil {
		return nil, err
	}
	return albums, nil
}

// searchRequest is the body of POST /api/search/metadata.
type searchRequest struct {
	AlbumIDs []string `json:"albumIds"`
	Page     int      `json:"page"`
	Size     int      `json:"size"`
}

// searchResponse is the part of the search response that is used.
type searchResponse struct {
	Assets struct {
		Items    []Asset `json:"items"`
		NextPage *string `json:"nextPage"`
	} `json:"assets"`
}

// AlbumAssets returns one page (1-based, 250 assets per page) of the images
// of an album. Videos are removed, so a page can have fewer than 250 items
// even if more pages follow. Needs the permission asset.read.
func (c *Client) AlbumAssets(ctx context.Context, albumID string, page int) (AssetPage, error) {
	if page < 1 {
		return AssetPage{}, fmt.Errorf("immich: invalid page %d", page)
	}
	body := searchRequest{AlbumIDs: []string{albumID}, Page: page, Size: assetPageSize}
	var res searchResponse
	if err := c.doJSON(ctx, http.MethodPost, "/search/metadata", body, &res); err != nil {
		return AssetPage{}, err
	}
	next, err := parseNextPage(res.Assets.NextPage)
	if err != nil {
		return AssetPage{}, err
	}
	images := make([]Asset, 0, len(res.Assets.Items))
	for _, a := range res.Assets.Items {
		if a.Type == AssetTypeImage {
			images = append(images, a)
		}
	}
	return AssetPage{Items: images, NextPage: next}, nil
}

// parseNextPage converts Immich's nextPage (a numeric string or null) to an
// int; 0 means there is no next page.
func parseNextPage(s *string) (int, error) {
	if s == nil || *s == "" {
		return 0, nil
	}
	n, err := strconv.Atoi(*s)
	if err != nil || n < 1 {
		return 0, fmt.Errorf("immich: invalid nextPage %q", *s)
	}
	return n, nil
}

// Thumbnail returns the image bytes of an asset in the given size and the
// Content-Type of the response (e.g. "image/jpeg" or "image/webp"). The
// caller must close the reader. Needs the permission asset.view.
func (c *Client) Thumbnail(ctx context.Context, assetID string, size ThumbnailSize) (io.ReadCloser, string, error) {
	path := "/assets/" + url.PathEscape(assetID) + "/thumbnail?size=" + url.QueryEscape(string(size))
	resp, err := c.do(ctx, http.MethodGet, path, nil)
	if err != nil {
		return nil, "", err
	}
	return resp.Body, resp.Header.Get("Content-Type"), nil
}

// doJSON sends a request with an optional JSON body and decodes the JSON
// response into out.
func (c *Client) doJSON(ctx context.Context, method, path string, body, out any) error {
	var reader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("immich: encode request: %w", err)
		}
		reader = bytes.NewReader(b)
	}
	resp, err := c.do(ctx, method, path, reader)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	// A wrong server URL often returns an HTML page with status 200.
	if mediaType, _, _ := mime.ParseMediaType(resp.Header.Get("Content-Type")); mediaType != "application/json" {
		return fmt.Errorf("unexpected answer from %s (not JSON): check that the URL is the Immich server URL",
			resp.Request.URL.Redacted())
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, maxJSONResponse)).Decode(out); err != nil {
		return fmt.Errorf("immich: decode response of %s %s: %w", method, resp.Request.URL.Path, err)
	}
	return nil
}

// do sends a request and returns the response if its status is 2xx. For
// other statuses it closes the body and returns a *StatusError.
func (c *Client) do(ctx context.Context, method, path string, body io.Reader) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, method, c.apiURL+path, body)
	if err != nil {
		return nil, fmt.Errorf("immich: build request: %w", err)
	}
	req.Header.Set(apiKeyHeader, c.apiKey)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("cannot reach the Immich server: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 64<<10))
		resp.Body.Close()
		return nil, &StatusError{Method: method, Path: req.URL.Path, StatusCode: resp.StatusCode}
	}
	return resp, nil
}
