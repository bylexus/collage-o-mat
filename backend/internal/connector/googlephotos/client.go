// Package googlephotos contains the Google Photos connector: the connector
// Kind for the type "googlephotos", the OAuth sign-in per import, a client
// for the Google Photos Picker API, the in-memory picks (selections) and the
// import source.
package googlephotos

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
	"time"
)

const (
	// pickerAPIURL is the base URL of the Google Photos Picker API. All
	// calls (also sessions.get) use this host.
	pickerAPIURL = "https://photospicker.googleapis.com/v1"
	// requestTimeout limits one Google request including reading the body.
	requestTimeout = 30 * time.Second
	// maxJSONResponse limits the size of a JSON response from Google (one
	// mediaItems page has at most 100 items).
	maxJSONResponse = 8 << 20 // 8 MiB
	// maxErrorBody limits the error body that is read for the status.
	maxErrorBody = 64 << 10 // 64 KiB
	// mediaItemsPageSize is the page size of mediaItems.list (maximum 100).
	mediaItemsPageSize = 100
	// maxMediaItemPages stops mediaItems.list after this many pages (a pick
	// has at most 2000 items = 20 pages).
	maxMediaItemPages = 50
)

// baseUrl suffixes (image sizes) of a media item.
const (
	// sizeThumbnail is the grid thumbnail: fits in 400×400 px.
	sizeThumbnail = "=w400-h400"
	// sizePreview is the preview import: fits in 2048×2048 px.
	sizePreview = "=w2048-h2048"
	// sizeOriginal is the original file (all EXIF except the location).
	sizeOriginal = "=d"
)

// Operations of the Picker API, used in error messages.
const (
	opCreateSession = "create picker session"
	opGetSession    = "get picker session"
	opDeleteSession = "delete picker session"
	opListItems     = "list picked photos"
	opDownload      = "download photo"
)

// APIError is returned for a Google response with a non-2xx status. Its
// message is safe to show to the user (it never contains the access token).
type APIError struct {
	Op         string
	StatusCode int
	// Status is Google's canonical error code (e.g. "FAILED_PRECONDITION"),
	// "" if the body has none.
	Status string
}

// Error implements the error interface.
func (e *APIError) Error() string {
	switch {
	case e.StatusCode == http.StatusUnauthorized:
		return "Google rejected the sign-in (HTTP 401). Start again."
	case e.Op == opCreateSession && e.Status == "FAILED_PRECONDITION":
		return "This Google account has no Google Photos."
	case e.Status == "RESOURCE_EXHAUSTED":
		return "Google Photos: too many requests or open picker sessions. Wait a moment and try again."
	case e.StatusCode == http.StatusForbidden:
		return "Google refused the request (HTTP 403). Check that the Google Photos Picker API is enabled in the Google Cloud project."
	case e.Status != "":
		return fmt.Sprintf("Google Photos: %s failed with HTTP %d (%s)", e.Op, e.StatusCode, e.Status)
	default:
		return fmt.Sprintf("Google Photos: %s failed with HTTP %d", e.Op, e.StatusCode)
	}
}

// isStatus reports whether err is an *APIError with the HTTP status code.
func isStatus(err error, code int) bool {
	var ae *APIError
	return errors.As(err, &ae) && ae.StatusCode == code
}

// isTransient reports whether err may go away on a retry: a network error,
// a timeout or a 5xx answer.
func isTransient(err error) bool {
	var ae *APIError
	if errors.As(err, &ae) {
		return ae.StatusCode >= 500
	}
	return true
}

// Client calls the Google Photos Picker API. It is safe for concurrent use.
// Each call takes the OAuth access token of the user; it is only sent in
// the Authorization header and is never part of an error message.
type Client struct {
	baseURL string
	http    *http.Client
}

// NewClient returns a Picker API client with a 30 s timeout per request.
func NewClient() *Client {
	return &Client{baseURL: pickerAPIURL, http: newHTTPClient()}
}

// newHTTPClient returns the HTTP client for Google requests (API, token
// exchange and downloads): 30 s timeout, at most 5 redirects. net/http does
// not forward the Authorization header to another domain on a redirect.
func newHTTPClient() *http.Client {
	return &http.Client{
		Timeout: requestTimeout,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 5 {
				return errors.New("stopped after 5 redirects")
			}
			return nil
		},
	}
}

// createSession creates a new picking session (sessions.create).
func (c *Client) createSession(ctx context.Context, token string) (pickingSession, error) {
	var s pickingSession
	err := c.doJSON(ctx, token, opCreateSession, http.MethodPost, c.baseURL+"/sessions", []byte("{}"), &s)
	if err != nil {
		return pickingSession{}, err
	}
	if s.ID == "" || !isHTTPS(s.PickerURI) {
		return pickingSession{}, errors.New("Google Photos: the new picker session has no id or no valid picker URL")
	}
	return s, nil
}

// getSession returns a picking session (sessions.get, the poll).
func (c *Client) getSession(ctx context.Context, token, sessionID string) (pickingSession, error) {
	var s pickingSession
	err := c.doJSON(ctx, token, opGetSession, http.MethodGet, c.sessionURL(sessionID), nil, &s)
	return s, err
}

// deleteSession deletes a picking session (sessions.delete).
func (c *Client) deleteSession(ctx context.Context, token, sessionID string) error {
	resp, err := c.do(ctx, token, opDeleteSession, http.MethodDelete, c.sessionURL(sessionID), nil)
	if err != nil {
		return err
	}
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, maxErrorBody))
	resp.Body.Close()
	return nil
}

func (c *Client) sessionURL(sessionID string) string {
	return c.baseURL + "/sessions/" + url.PathEscape(sessionID)
}

// listMediaItems returns all media items that the user picked in a session
// (mediaItems.list, all pages).
func (c *Client) listMediaItems(ctx context.Context, token, sessionID string) ([]pickedMediaItem, error) {
	var items []pickedMediaItem
	pageToken := ""
	for range maxMediaItemPages {
		q := url.Values{}
		q.Set("sessionId", sessionID)
		q.Set("pageSize", fmt.Sprint(mediaItemsPageSize))
		if pageToken != "" {
			q.Set("pageToken", pageToken)
		}
		var page listMediaItemsResponse
		if err := c.doJSON(ctx, token, opListItems, http.MethodGet, c.baseURL+"/mediaItems?"+q.Encode(), nil, &page); err != nil {
			return nil, err
		}
		items = append(items, page.MediaItems...)
		if page.NextPageToken == "" {
			return items, nil
		}
		pageToken = page.NextPageToken
	}
	return nil, fmt.Errorf("Google Photos: %s stopped after %d pages", opListItems, maxMediaItemPages)
}

// download returns the bytes of a media item (baseURL + size suffix) and
// the Content-Type of the response. The caller must close the reader.
func (c *Client) download(ctx context.Context, token, baseURL, size string) (io.ReadCloser, string, error) {
	if !isHTTPS(baseURL) {
		return nil, "", errors.New("Google Photos: the photo has no valid download URL")
	}
	resp, err := c.do(ctx, token, opDownload, http.MethodGet, baseURL+size, nil)
	if err != nil {
		return nil, "", err
	}
	return resp.Body, resp.Header.Get("Content-Type"), nil
}

// doJSON sends a request with an optional JSON body and decodes the JSON
// response into out.
func (c *Client) doJSON(ctx context.Context, token, op, method, rawURL string, body []byte, out any) error {
	var reader io.Reader
	if body != nil {
		reader = bytes.NewReader(body)
	}
	resp, err := c.do(ctx, token, op, method, rawURL, reader)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if mediaType, _, _ := mime.ParseMediaType(resp.Header.Get("Content-Type")); mediaType != "application/json" {
		return fmt.Errorf("Google Photos: unexpected answer to %s (not JSON)", op)
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, maxJSONResponse)).Decode(out); err != nil {
		return fmt.Errorf("Google Photos: cannot read the answer to %s: %w", op, err)
	}
	return nil
}

// do sends a request with the bearer token and returns the response if its
// status is 2xx. For other statuses it closes the body and returns an
// *APIError. Transport errors never contain the request URL (a baseUrl is a
// secret-like URL).
func (c *Client) do(ctx context.Context, token, op, method, rawURL string, body io.Reader) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, method, rawURL, body)
	if err != nil {
		return nil, fmt.Errorf("Google Photos: build request for %s: %w", op, err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, transportError(op, err)
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		ae := &APIError{Op: op, StatusCode: resp.StatusCode}
		var er errorResponse
		if json.NewDecoder(io.LimitReader(resp.Body, maxErrorBody)).Decode(&er) == nil {
			ae.Status = er.Error.Status
		}
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, maxErrorBody))
		resp.Body.Close()
		return nil, ae
	}
	return resp, nil
}

// transportError returns a user-safe error for a request that got no HTTP
// answer. The URL of the *url.Error is dropped.
func transportError(op string, err error) error {
	if errors.Is(err, context.DeadlineExceeded) {
		return fmt.Errorf("Google Photos cannot be reached (%s): timeout", op)
	}
	if errors.Is(err, context.Canceled) {
		return fmt.Errorf("Google Photos: %s was cancelled", op)
	}
	var ue *url.Error
	if errors.As(err, &ue) && ue.Err != nil {
		if ue.Timeout() {
			return fmt.Errorf("Google Photos cannot be reached (%s): timeout", op)
		}
		return fmt.Errorf("Google Photos cannot be reached (%s): %v", op, ue.Err)
	}
	return fmt.Errorf("Google Photos cannot be reached (%s)", op)
}

// isHTTPS reports whether s is an absolute https URL with a host.
func isHTTPS(s string) bool {
	u, err := url.Parse(s)
	return err == nil && u.Scheme == "https" && u.Host != ""
}
