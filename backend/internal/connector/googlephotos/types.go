package googlephotos

// Google Photos Picker API response types (only the fields that are used).
// See https://developers.google.com/photos/picker/reference/rest.

// pickingSession is a Google PickingSession.
type pickingSession struct {
	ID string `json:"id"`
	// PickerURI is the page where the user picks the photos. It must be
	// opened in a window or tab (never in an iframe).
	PickerURI string `json:"pickerUri"`
	// PollingConfig is set only while MediaItemsSet is false.
	PollingConfig *pollingConfig `json:"pollingConfig"`
	// ExpireTime is an RFC 3339 timestamp.
	ExpireTime    string `json:"expireTime"`
	MediaItemsSet bool   `json:"mediaItemsSet"`
}

// pollingConfig is the polling advice of a picking session. Both values are
// durations like "3.5s".
type pollingConfig struct {
	PollInterval string `json:"pollInterval"`
	TimeoutIn    string `json:"timeoutIn"`
}

// mediaItemType is the type of a picked media item.
type mediaItemType string

// mediaItemTypePhoto is the only type that is imported.
const mediaItemTypePhoto mediaItemType = "PHOTO"

// pickedMediaItem is a Google PickedMediaItem.
type pickedMediaItem struct {
	// ID is persistent: the same photo always has the same id.
	ID        string        `json:"id"`
	Type      mediaItemType `json:"type"`
	MediaFile mediaFile     `json:"mediaFile"`
}

// mediaFile is the file of a picked media item.
type mediaFile struct {
	// BaseURL is valid for 60 minutes and needs the access token. It must
	// be used with a suffix like "=d" or "=w<N>-h<N>".
	BaseURL           string            `json:"baseUrl"`
	MimeType          string            `json:"mimeType"`
	Filename          string            `json:"filename"`
	MediaFileMetadata mediaFileMetadata `json:"mediaFileMetadata"`
}

// mediaFileMetadata holds the image size of a media file.
type mediaFileMetadata struct {
	Width  int `json:"width"`
	Height int `json:"height"`
}

// listMediaItemsResponse is one page of mediaItems.list.
type listMediaItemsResponse struct {
	MediaItems    []pickedMediaItem `json:"mediaItems"`
	NextPageToken string            `json:"nextPageToken"`
}

// errorResponse is the error body of Google APIs.
type errorResponse struct {
	Error struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
		// Status is the canonical code, e.g. "FAILED_PRECONDITION".
		Status string `json:"status"`
	} `json:"error"`
}
