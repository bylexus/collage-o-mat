package googlephotos

import (
	"html/template"
	"io"
	"log/slog"
	"net/http"

	"collageomat/internal/auth"
	"collageomat/internal/httpapi"
)

// thumbnailCacheControl is the Cache-Control of proxied thumbnails.
const thumbnailCacheControl = "private, max-age=86400"

// Handler serves the Google Photos routes: the picks of a connector
// (/api/connectors/{id}/googlephotos/...) and the OAuth callback
// (CallbackPath). It implements httpapi.Module.
type Handler struct {
	svc *Service
}

// NewHandler returns the Google Photos HTTP handler.
func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// RegisterRoutes implements httpapi.Module. All routes need a session; the
// OAuth callback too (the SameSite=Lax cookie is sent on the top-level
// redirect from Google).
func (h *Handler) RegisterRoutes(mux *http.ServeMux, requireAuth httpapi.Middleware) {
	mux.Handle("POST /api/connectors/{id}/googlephotos/picks", requireAuth(http.HandlerFunc(h.createPick)))
	mux.Handle("GET /api/connectors/{id}/googlephotos/picks/{pickId}", requireAuth(http.HandlerFunc(h.pick)))
	mux.Handle("DELETE /api/connectors/{id}/googlephotos/picks/{pickId}", requireAuth(http.HandlerFunc(h.deletePick)))
	mux.Handle("GET /api/connectors/{id}/googlephotos/picks/{pickId}/items/{itemId}/thumbnail", requireAuth(http.HandlerFunc(h.thumbnail)))
	mux.Handle("GET "+CallbackPath, requireAuth(http.HandlerFunc(h.callback)))
}

type createPickResponse struct {
	PickID string `json:"pickId"`
	// OpenURL is the URL for the popup window: Google's sign-in page or
	// the picker page.
	OpenURL string `json:"openUrl"`
}

type itemResponse struct {
	ID       string `json:"id"`
	FileName string `json:"fileName"`
	Width    int    `json:"width"`
	Height   int    `json:"height"`
	// MimeType is the MIME type of the original file (e.g. "image/heic").
	MimeType string `json:"mimeType"`
}

type pickResponse struct {
	// Status is "signin", "picking", "done" or "error".
	Status         string `json:"status"`
	PollIntervalMs int64  `json:"pollIntervalMs"`
	// Error is the user-safe reason of status "error".
	Error string `json:"error,omitempty"`
	// Items is empty unless the status is "done".
	Items         []itemResponse `json:"items"`
	SkippedVideos int            `json:"skippedVideos"`
}

func toPickResponse(p PickStatus) pickResponse {
	resp := pickResponse{
		Status:         p.Status,
		PollIntervalMs: p.PollInterval.Milliseconds(),
		Error:          p.Error,
		Items:          make([]itemResponse, len(p.Items)),
		SkippedVideos:  p.SkippedVideos,
	}
	for i, it := range p.Items {
		resp.Items[i] = itemResponse(it)
	}
	return resp
}

func (h *Handler) createPick(w http.ResponseWriter, r *http.Request) {
	connectorID, err := httpapi.PathID(r, "id")
	if err != nil {
		httpapi.WriteServiceError(w, err)
		return
	}
	pickID, openURL, err := h.svc.CreatePick(r.Context(), auth.UserID(r), connectorID)
	if err != nil {
		httpapi.WriteServiceError(w, err)
		return
	}
	httpapi.WriteJSON(w, http.StatusCreated, createPickResponse{PickID: pickID, OpenURL: openURL})
}

func (h *Handler) pick(w http.ResponseWriter, r *http.Request) {
	connectorID, err := httpapi.PathID(r, "id")
	if err != nil {
		httpapi.WriteServiceError(w, err)
		return
	}
	p, err := h.svc.Pick(r.Context(), auth.UserID(r), connectorID, r.PathValue("pickId"))
	if err != nil {
		httpapi.WriteServiceError(w, err)
		return
	}
	httpapi.WriteJSON(w, http.StatusOK, toPickResponse(p))
}

func (h *Handler) deletePick(w http.ResponseWriter, r *http.Request) {
	connectorID, err := httpapi.PathID(r, "id")
	if err != nil {
		httpapi.WriteServiceError(w, err)
		return
	}
	if err := h.svc.DeletePick(r.Context(), auth.UserID(r), connectorID, r.PathValue("pickId")); err != nil {
		httpapi.WriteServiceError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) thumbnail(w http.ResponseWriter, r *http.Request) {
	connectorID, err := httpapi.PathID(r, "id")
	if err != nil {
		httpapi.WriteServiceError(w, err)
		return
	}
	body, contentType, err := h.svc.Thumbnail(r.Context(), auth.UserID(r), connectorID,
		r.PathValue("pickId"), r.PathValue("itemId"))
	if err != nil {
		httpapi.WriteServiceError(w, err)
		return
	}
	defer body.Close()
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", thumbnailCacheControl)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(http.StatusOK)
	if _, err := io.Copy(w, body); err != nil {
		// The status is already sent; the client sees a broken image.
		slog.Warn("proxy googlephotos thumbnail", "connector", connectorID, "err", err)
	}
}

// callback is the OAuth redirect target (in the popup window). Success
// redirects to the picker page; a failure shows a small HTML page (the
// dialog sees the pick status "error").
func (h *Handler) callback(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	pickerURL, err := h.svc.Callback(r.Context(), auth.UserID(r), q.Get("state"), q.Get("code"), q.Get("error"))
	if err != nil {
		reason, known := signinFailureReason(err)
		if !known {
			slog.Error("googlephotos: sign-in callback", "err", err)
		}
		writeSigninFailure(w, reason)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	http.Redirect(w, r, pickerURL, http.StatusFound)
}

// signinFailurePage is the page of a failed sign-in. html/template escapes
// the reason.
var signinFailurePage = template.Must(template.New("signin").Parse(`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Google sign-in failed</title></head>
<body style="font-family: sans-serif; margin: 2rem;">
<p>Sign-in failed: {{.}}. Close this window.</p>
</body>
</html>
`))

// writeSigninFailure writes the HTML page of a failed sign-in (status 400).
func writeSigninFailure(w http.ResponseWriter, reason string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusBadRequest)
	if err := signinFailurePage.Execute(w, reason); err != nil {
		slog.Warn("googlephotos: write sign-in failure page", "err", err)
	}
}
