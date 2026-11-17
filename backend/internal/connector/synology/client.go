// Package synology contains the Synology connector: an HTTP client for the
// Web API of Synology Photos on DSM 7 (with session handling) and the
// connector Kind for the type "synology".
package synology

import (
	"context"
	"crypto/tls"
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
	// requestTimeout limits one NAS request including reading the body.
	requestTimeout = 30 * time.Second
	// maxJSONResponse limits the size of a JSON response from the NAS.
	maxJSONResponse = 32 << 20 // 32 MiB
	// entryPath is the path of the Web API on the NAS.
	entryPath = "/webapi/entry.cgi"
	// sidParam is the request parameter that carries the session id.
	sidParam = "_sid"
)

// APIError is a Synology Web API answer with "success": false. Its message
// is safe to show to the user (it never contains the password or the
// session id).
type APIError struct {
	// API is the name of the called API, e.g. "SYNO.Foto.Browse.Album".
	API string
	// Code is the Synology error code.
	Code int
	// Login is true if the error is the answer to a login.
	Login bool
}

// Error implements the error interface.
func (e *APIError) Error() string {
	if e.Login {
		return "Synology login failed: " + loginErrorText(e.Code)
	}
	switch e.Code {
	case codeNoPermission:
		return fmt.Sprintf("the Synology account has no permission for %s (error code %d)", e.API, e.Code)
	case codeSessionTimeout, codeSessionInterrupted, codeInvalidSession:
		return fmt.Sprintf("the Synology session is no longer valid (error code %d)", e.Code)
	case codeAPINotExist, codeMethodNotExist, codeVersionNotSupported:
		return fmt.Sprintf("the NAS does not support %s (error code %d): Synology Photos on DSM 7 is needed",
			e.API, e.Code)
	}
	return fmt.Sprintf("Synology request %s failed (error code %d)", e.API, e.Code)
}

// loginErrorText returns the user message for a login error code.
func loginErrorText(code int) string {
	switch code {
	case codeLoginWrongPassword:
		return "wrong account or password"
	case codeLoginDisabled:
		return "the account is disabled"
	case codeLoginDenied:
		return "the account has no permission to log in"
	case codeLogin2FARequired, codeLogin2FAFailed, codeLogin2FAEnforced:
		return "the account uses 2-factor authentication; use an account without 2-factor authentication"
	case codeLoginBlockedIP:
		return "the NAS blocked the IP address of this server (auto-block); unblock it in DSM"
	case codeLoginExpiredNoChange, codeLoginExpired, codeLoginMustChange:
		return "the password of the account has expired or must be changed"
	}
	return fmt.Sprintf("error code %d", code)
}

// isSessionError reports whether err means that the session id is no longer
// valid, so that a new login can help.
func isSessionError(err error) bool {
	var ae *APIError
	if !errors.As(err, &ae) || ae.Login {
		return false
	}
	return ae.Code == codeSessionTimeout || ae.Code == codeSessionInterrupted || ae.Code == codeInvalidSession
}

// StatusError is returned for a NAS response with a non-2xx status.
type StatusError struct {
	API        string
	StatusCode int
}

// Error implements the error interface. The message is safe to show to the
// user.
func (e *StatusError) Error() string {
	return fmt.Sprintf("Synology request %s failed with HTTP %d", e.API, e.StatusCode)
}

// Client calls the Web API of one NAS with one account. It is safe for
// concurrent use. It logs in when it needs a session, shares the session
// with all clients of the same session cache entry and logs in again once
// when the NAS reports an expired or invalid session. The password and the
// session id are never part of an error message.
type Client struct {
	baseURL  string // scheme://host[:port]
	account  string
	password string
	http     *http.Client
	session  *session
	// passphrases caches the share tokens of the albums shared with the
	// account (shared with all clients of the same session cache entry).
	passphrases *passphraseCache
}

// newClient returns a client for the NAS and account of cfg that uses the
// HTTP client httpClient, the session s and the passphrase cache p.
func newClient(cfg Config, httpClient *http.Client, s *session, p *passphraseCache) *Client {
	return &Client{
		baseURL:     cfg.URL,
		account:     cfg.Account,
		password:    cfg.Password,
		http:        httpClient,
		session:     s,
		passphrases: p,
	}
}

// NewHTTPClient returns the HTTP client for NAS requests: 30 s timeout, and
// redirects only to the same host (the session id must not be sent to
// another host). With skipTLSVerify the TLS certificate of the NAS is not
// checked (for self-signed certificates).
func NewHTTPClient(skipTLSVerify bool) *http.Client {
	c := &http.Client{
		Timeout:       requestTimeout,
		CheckRedirect: sameHostRedirectsOnly,
	}
	if skipTLSVerify {
		t := http.DefaultTransport.(*http.Transport).Clone()
		t.TLSClientConfig = &tls.Config{InsecureSkipVerify: true}
		c.Transport = t
	}
	return c
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

// apiParams returns the request parameters api, version and method.
func apiParams(api string, version int, method string) url.Values {
	return url.Values{
		"api":     {api},
		"version": {strconv.Itoa(version)},
		"method":  {method},
	}
}

// probeAlbums reads at most one album of the account. It is used by the
// connection test to check the access to Synology Photos.
func (c *Client) probeAlbums(ctx context.Context) error {
	params := apiParams(apiBrowseAlbum, apiBrowseAlbumVersion, "list")
	params.Set("offset", "0")
	params.Set("limit", "1")
	_, err := c.call(ctx, params)
	return err
}

// listAlbums returns at most limit albums of the account, starting at
// offset (SYNO.Foto.Browse.Album list; limit must be > 0, limit=0 returns
// an empty list).
func (c *Client) listAlbums(ctx context.Context, offset, limit int) ([]Album, error) {
	params := apiParams(apiBrowseAlbum, apiBrowseAlbumVersion, "list")
	setRange(params, offset, limit)
	var res listData[Album]
	if err := c.callInto(ctx, params, &res); err != nil {
		return nil, err
	}
	return res.List, nil
}

// listSharedAlbums returns at most limit albums that other users shared
// with the account, starting at offset (SYNO.Foto.Sharing.Misc
// list_shared_with_me_album).
func (c *Client) listSharedAlbums(ctx context.Context, offset, limit int) ([]SharedAlbum, error) {
	params := apiParams(apiSharingMisc, apiSharingMiscVersion, "list_shared_with_me_album")
	setRange(params, offset, limit)
	var res listData[SharedAlbum]
	if err := c.callInto(ctx, params, &res); err != nil {
		return nil, err
	}
	return res.List, nil
}

// listItems returns at most limit items (all types) of an album, a folder
// or a shared album, starting at offset. filterParam is "album_id" or
// "folder_id" with the decimal id as filterValue, or "passphrase" with the
// share token of a shared album (unquoted; never together with album_id,
// that gives error 120). With a wrong name the NAS ignores the filter and
// returns the whole library. Folders give only their direct items.
func (c *Client) listItems(ctx context.Context, filterParam, filterValue string, offset, limit int) ([]Item, error) {
	params := apiParams(apiBrowseItem, apiBrowseItemVersion, "list")
	params.Set(filterParam, filterValue)
	setRange(params, offset, limit)
	params.Set("additional", `["thumbnail","resolution","orientation"]`)
	var res listData[Item]
	if err := c.callInto(ctx, params, &res); err != nil {
		return nil, err
	}
	return res.List, nil
}

// getFolder returns the folder id, or the root folder of the Personal
// Space if id is 0.
func (c *Client) getFolder(ctx context.Context, id int64) (Folder, error) {
	params := apiParams(apiBrowseFolder, apiBrowseFolderVersion, "get")
	if id != 0 {
		params.Set("id", strconv.FormatInt(id, 10))
	}
	var res folderData
	if err := c.callInto(ctx, params, &res); err != nil {
		return Folder{}, err
	}
	return res.Folder, nil
}

// listFolders returns at most limit direct subfolders of the folder id (of
// the root folder if id is 0), starting at offset.
func (c *Client) listFolders(ctx context.Context, id int64, offset, limit int) ([]Folder, error) {
	params := apiParams(apiBrowseFolder, apiBrowseFolderVersion, "list")
	if id != 0 {
		params.Set("id", strconv.FormatInt(id, 10))
	}
	setRange(params, offset, limit)
	var res listData[Folder]
	if err := c.callInto(ctx, params, &res); err != nil {
		return nil, err
	}
	return res.List, nil
}

// thumbnail returns a thumbnail of the item id in the size size ("sm",
// "m" or "xl") and its Content-Type. The caller must close the body.
// cacheKey is the item's thumbnail cache key (the NAS does not check it;
// it only makes the URL change when the photo changes). passphrase is the
// share token for an item of a shared album, "" for an own item. A shared
// item is requested with type "item" and the quoted passphrase, without
// album_id (with album_id the NAS answers 404). Thumbnails are already
// rotated.
func (c *Client) thumbnail(ctx context.Context, id int64, cacheKey, size, passphrase string) (io.ReadCloser, string, error) {
	params := apiParams(apiThumbnail, apiThumbnailVersion, "get")
	params.Set("id", strconv.FormatInt(id, 10))
	params.Set("cache_key", strconv.Quote(cacheKey))
	if passphrase != "" {
		params.Set("type", `"item"`)
		params.Set("passphrase", strconv.Quote(passphrase))
	} else {
		params.Set("type", `"unit"`)
	}
	params.Set("size", strconv.Quote(size))
	return c.download(ctx, http.MethodGet, params)
}

// original returns the original file of the item id (SYNO.Foto.Download
// with exactly one unit_id; two or more ids give a ZIP archive) and its
// Content-Type. The caller must close the body. passphrase is the share
// token for an item of a shared album (sent quoted), "" for an own item.
// The file is not rotated (EXIF orientation as stored).
func (c *Client) original(ctx context.Context, id int64, passphrase string) (io.ReadCloser, string, error) {
	params := apiParams(apiDownload, apiDownloadVersion, "download")
	params.Set("unit_id", "["+strconv.FormatInt(id, 10)+"]")
	if passphrase != "" {
		params.Set("passphrase", strconv.Quote(passphrase))
	}
	return c.download(ctx, http.MethodPost, params)
}

// setRange sets the paging parameters offset and limit.
func setRange(params url.Values, offset, limit int) {
	params.Set("offset", strconv.Itoa(offset))
	params.Set("limit", strconv.Itoa(limit))
}

// callInto is call that decodes the data of the answer into out.
func (c *Client) callInto(ctx context.Context, params url.Values, out any) error {
	data, err := c.call(ctx, params)
	if err != nil {
		return err
	}
	if err := json.Unmarshal(data, out); err != nil {
		return fmt.Errorf("synology: decode response of %s: %w", params.Get("api"), err)
	}
	return nil
}

// Logout ends the current session of the client, if it has one. Errors are
// ignored (the session expires on the NAS anyway).
func (c *Client) Logout(ctx context.Context) {
	sid := c.session.take()
	if sid == "" {
		return
	}
	params := apiParams(apiAuth, apiAuthVersion, "logout")
	params.Set(sidParam, sid)
	resp, err := c.send(ctx, http.MethodPost, params)
	if err != nil {
		return
	}
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 64<<10))
	resp.Body.Close()
}

// call sends a POST request with the session id and returns the data of
// the JSON answer. params must contain api, version and method.
func (c *Client) call(ctx context.Context, params url.Values) (json.RawMessage, error) {
	var data json.RawMessage
	err := c.withSession(ctx, func(sid string) error {
		resp, err := c.send(ctx, http.MethodPost, withSID(params, sid))
		if err != nil {
			return err
		}
		data, err = c.decodeEnvelope(resp, params.Get("api"))
		return err
	})
	return data, err
}

// download sends a request with the session id that answers with a file
// (e.g. a thumbnail or an original) and returns the body and its
// Content-Type. The caller must close the body. A JSON answer is an error
// (the NAS reports errors as JSON, also with HTTP 200). httpMethod is GET
// (parameters in the query) or POST (form body).
func (c *Client) download(ctx context.Context, httpMethod string, params url.Values) (io.ReadCloser, string, error) {
	var (
		body        io.ReadCloser
		contentType string
	)
	err := c.withSession(ctx, func(sid string) error {
		resp, err := c.send(ctx, httpMethod, withSID(params, sid))
		if err != nil {
			return err
		}
		contentType = resp.Header.Get("Content-Type")
		if !isJSON(contentType) {
			body = resp.Body
			return nil
		}
		if _, err := c.decodeEnvelope(resp, params.Get("api")); err != nil {
			return err
		}
		return fmt.Errorf("Synology request %s returned no file", params.Get("api"))
	})
	if err != nil {
		return nil, "", err
	}
	return body, contentType, nil
}

// withSession runs fn with a session id. If fn reports an invalid session,
// the client logs in again once and repeats fn. Login errors are returned
// without a new attempt (repeated failed logins make the NAS block the IP
// address of this server).
func (c *Client) withSession(ctx context.Context, fn func(sid string) error) error {
	for attempt := 0; ; attempt++ {
		sid, err := c.session.get(ctx, c.login)
		if err != nil {
			return err
		}
		err = fn(sid)
		if attempt == 0 && isSessionError(err) {
			c.session.invalidate(sid)
			continue
		}
		return err
	}
}

// login logs in with account and password (SYNO.API.Auth, format=sid; no
// "session" parameter: a custom session name gives error 402) and returns
// the session id. It is sent as POST, so the password is not in a URL.
func (c *Client) login(ctx context.Context) (string, error) {
	params := apiParams(apiAuth, apiAuthVersion, "login")
	params.Set("account", c.account)
	params.Set("passwd", c.password)
	params.Set("format", "sid")
	resp, err := c.send(ctx, http.MethodPost, params)
	if err != nil {
		return "", err
	}
	data, err := c.decodeEnvelope(resp, apiAuth)
	if err != nil {
		var ae *APIError
		if errors.As(err, &ae) {
			ae.Login = true
		}
		return "", err
	}
	var login loginData
	if err := json.Unmarshal(data, &login); err != nil || login.SID == "" {
		return "", errors.New("Synology login failed: the NAS returned no session")
	}
	return login.SID, nil
}

// withSID returns a copy of params with the session id.
func withSID(params url.Values, sid string) url.Values {
	out := make(url.Values, len(params)+1)
	for k, v := range params {
		out[k] = v
	}
	out.Set(sidParam, sid)
	return out
}

// send sends a request to the Web API and returns the response if its
// status is 2xx. For other statuses it closes the body and returns a
// *StatusError. Errors never contain the request URL or body (they can
// contain the session id or the password).
func (c *Client) send(ctx context.Context, httpMethod string, params url.Values) (*http.Response, error) {
	target := c.baseURL + entryPath
	var body io.Reader
	if httpMethod == http.MethodGet {
		target += "?" + params.Encode()
	} else {
		body = strings.NewReader(params.Encode())
	}
	req, err := http.NewRequestWithContext(ctx, httpMethod, target, body)
	if err != nil {
		return nil, errors.New("synology: cannot build the request: check the NAS URL")
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, reachError(err)
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 64<<10))
		resp.Body.Close()
		return nil, &StatusError{API: params.Get("api"), StatusCode: resp.StatusCode}
	}
	return resp, nil
}

// reachError returns the error for a failed HTTP request without the
// request URL (a *url.Error contains it, and a GET URL contains the
// session id).
func reachError(err error) error {
	var ue *url.Error
	if errors.As(err, &ue) {
		err = ue.Err
	}
	var certErr *tls.CertificateVerificationError
	if errors.As(err, &certErr) {
		return fmt.Errorf("cannot reach the Synology NAS: %w (for a self-signed certificate, enable \"Skip TLS certificate verification\")", err)
	}
	return fmt.Errorf("cannot reach the Synology NAS: %w", err)
}

// decodeEnvelope reads the JSON answer of resp, closes the body and
// returns its data. "success": false gives an *APIError.
func (c *Client) decodeEnvelope(resp *http.Response, api string) (json.RawMessage, error) {
	defer resp.Body.Close()
	// A wrong URL often returns an HTML page with status 200.
	if !isJSON(resp.Header.Get("Content-Type")) {
		return nil, fmt.Errorf("unexpected answer from %s (not JSON): check that the URL is the DSM address of the NAS, e.g. https://nas.example.com:5001",
			c.baseURL)
	}
	var env envelope
	if err := json.NewDecoder(io.LimitReader(resp.Body, maxJSONResponse)).Decode(&env); err != nil {
		return nil, fmt.Errorf("synology: decode response of %s: %w", api, err)
	}
	if !env.Success {
		code := 0
		if env.Error != nil {
			code = env.Error.Code
		}
		return nil, &APIError{API: api, Code: code}
	}
	return env.Data, nil
}

// isJSON reports whether a Content-Type is application/json.
func isJSON(contentType string) bool {
	mediaType, _, _ := mime.ParseMediaType(contentType)
	return mediaType == "application/json"
}
