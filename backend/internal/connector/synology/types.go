package synology

import "encoding/json"

// Synology Web API names and versions used by Collage-o-mat. All APIs are
// served at entryPath (verified with SYNO.API.Info on DSM 7).
const (
	apiAuth        = "SYNO.API.Auth"
	apiAuthVersion = 6

	apiBrowseAlbum        = "SYNO.Foto.Browse.Album"
	apiBrowseAlbumVersion = 1

	apiBrowseItem        = "SYNO.Foto.Browse.Item"
	apiBrowseItemVersion = 1

	apiBrowseFolder        = "SYNO.Foto.Browse.Folder"
	apiBrowseFolderVersion = 2

	apiThumbnail        = "SYNO.Foto.Thumbnail"
	apiThumbnailVersion = 2

	apiDownload        = "SYNO.Foto.Download"
	apiDownloadVersion = 2

	apiSharingMisc        = "SYNO.Foto.Sharing.Misc"
	apiSharingMiscVersion = 2
)

// Common error codes of the Synology Web API (DSM Login Web API Guide).
const (
	codeNoPermission        = 105
	codeSessionTimeout      = 106
	codeSessionInterrupted  = 107
	codeInvalidSession      = 119
	codeAPINotExist         = 102
	codeMethodNotExist      = 103
	codeVersionNotSupported = 104
)

// Error codes of SYNO.API.Auth login (DSM Login Web API Guide).
const (
	codeLoginWrongPassword   = 400
	codeLoginDisabled        = 401
	codeLoginDenied          = 402
	codeLogin2FARequired     = 403
	codeLogin2FAFailed       = 404
	codeLogin2FAEnforced     = 406
	codeLoginBlockedIP       = 407
	codeLoginExpiredNoChange = 408
	codeLoginExpired         = 409
	codeLoginMustChange      = 410
)

// envelope is the JSON answer of every Synology Web API call (also with
// HTTP 200 for errors): {"success":true,"data":{...}} or
// {"success":false,"error":{"code":N}}.
type envelope struct {
	Success bool            `json:"success"`
	Data    json.RawMessage `json:"data"`
	Error   *struct {
		Code int `json:"code"`
	} `json:"error"`
}

// loginData is the data of a successful SYNO.API.Auth login with
// format=sid.
type loginData struct {
	SID string `json:"sid"`
}

// Album is an album of the Personal Space (subset of a
// SYNO.Foto.Browse.Album list item). The API has no cover field.
type Album struct {
	ID        int64  `json:"id"`
	Name      string `json:"name"`
	ItemCount int    `json:"item_count"`
	// Type is "normal" or "condition" (conditional album).
	Type string `json:"type"`
}

// SharedAlbum is an album of another NAS user that is shared with the
// account (subset of a SYNO.Foto.Sharing.Misc list_shared_with_me_album
// item; the fields are not verified on a NAS yet).
type SharedAlbum struct {
	ID        int64  `json:"id"`
	Name      string `json:"name"`
	ItemCount int    `json:"item_count"`
	// Passphrase is the share token of the album. It is needed to read the
	// album's items, thumbnails and originals. It is a share secret: it
	// stays on the server (never in a response, an error or a log).
	Passphrase string `json:"passphrase"`
}

// Item types of SYNO.Foto.Browse.Item.
const (
	ItemTypePhoto = "photo"
	ItemTypeLive  = "live"
	ItemTypeVideo = "video"
)

// Item is a photo or video of Synology Photos (subset of a
// SYNO.Foto.Browse.Item list item, requested with
// additional=["thumbnail","resolution","orientation"]).
type Item struct {
	ID       int64  `json:"id"`
	Filename string `json:"filename"`
	// Type is "photo", "live" or "video".
	Type       string         `json:"type"`
	Additional itemAdditional `json:"additional"`
}

// itemAdditional holds the additional fields of an item.
type itemAdditional struct {
	// Resolution is the displayed size (EXIF orientation already applied).
	Resolution struct {
		Width  int `json:"width"`
		Height int `json:"height"`
	} `json:"resolution"`
	Orientation int `json:"orientation"`
	Thumbnail   struct {
		// CacheKey is "<id>_<timestamp>"; it changes when the photo
		// changes on the NAS.
		CacheKey string `json:"cache_key"`
		UnitID   int64  `json:"unit_id"`
	} `json:"thumbnail"`
}

// ItemPage is one page of the photos of an album or folder.
type ItemPage struct {
	// Items contains only photos and Live Photos (videos are removed).
	Items []Item
	// NextPage is the number of the next page, 0 if this is the last page.
	NextPage int
}

// Folder is a folder of the Personal Space (subset of a
// SYNO.Foto.Browse.Folder item).
type Folder struct {
	ID int64 `json:"id"`
	// Name is the full path, e.g. "/Ordner 1/Sub-Ordner 1"; the root
	// folder is "/".
	Name string `json:"name"`
	// Parent is the id of the parent folder; for the root folder it is
	// its own id.
	Parent int64 `json:"parent"`
}

// IsRoot reports whether f is the root folder of the Personal Space.
func (f Folder) IsRoot() bool { return f.Parent == f.ID }

// FolderContent is a folder with its direct subfolders.
type FolderContent struct {
	Folder Folder
	// Subfolders are sorted by name (case-insensitive).
	Subfolders []Folder
}

// listData is the data of a SYNO.Foto.* list call.
type listData[T any] struct {
	List []T `json:"list"`
}

// folderData is the data of SYNO.Foto.Browse.Folder get.
type folderData struct {
	Folder Folder `json:"folder"`
}
