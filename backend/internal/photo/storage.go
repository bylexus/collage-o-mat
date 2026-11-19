package photo

import (
	"crypto/rand"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
)

const (
	dirPerm  = 0o750
	filePerm = 0o640
)

// DiskStorage stores files in a directory on the local disk (the photo
// directory). All paths are relative to that directory, use "/" as
// separator and cannot leave it (os.Root rejects "..", absolute paths and
// symlinks that point outside). It is safe for concurrent use.
type DiskStorage struct {
	root *os.Root
}

// NewDiskStorage creates dir if needed and returns a storage for it. Call
// Close when it is no longer needed.
func NewDiskStorage(dir string) (*DiskStorage, error) {
	if err := os.MkdirAll(dir, dirPerm); err != nil {
		return nil, fmt.Errorf("create photo dir %q: %w", dir, err)
	}
	root, err := os.OpenRoot(dir)
	if err != nil {
		return nil, fmt.Errorf("open photo dir %q: %w", dir, err)
	}
	return &DiskStorage{root: root}, nil
}

// Close releases the directory handle.
func (s *DiskStorage) Close() error {
	return s.root.Close()
}

// Save writes the content of r to relPath, creating parent directories. The
// write is atomic: the data goes to a temporary file in the same directory,
// which is renamed to relPath at the end. On error no file is left.
func (s *DiskStorage) Save(relPath string, r io.Reader) (err error) {
	dir := path.Dir(relPath)
	if err := s.root.MkdirAll(dir, dirPerm); err != nil {
		return fmt.Errorf("create dir %q: %w", dir, err)
	}
	tmpPath := path.Join(dir, ".tmp-"+rand.Text())
	f, err := s.root.OpenFile(tmpPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, filePerm)
	if err != nil {
		return fmt.Errorf("create temp file: %w", err)
	}
	defer func() {
		if err != nil {
			_ = s.root.Remove(tmpPath)
		}
	}()
	if _, err := io.Copy(f, r); err != nil {
		_ = f.Close()
		return fmt.Errorf("write %q: %w", relPath, err)
	}
	if err := f.Close(); err != nil {
		return fmt.Errorf("close %q: %w", relPath, err)
	}
	if err := s.root.Rename(tmpPath, relPath); err != nil {
		return fmt.Errorf("rename temp file to %q: %w", relPath, err)
	}
	return nil
}

// Open opens relPath for reading. The caller must close it.
func (s *DiskStorage) Open(relPath string) (io.ReadSeekCloser, error) {
	f, err := s.root.Open(relPath)
	if err != nil {
		return nil, fmt.Errorf("open %q: %w", relPath, err)
	}
	return f, nil
}

// Size returns the size of the file relPath in bytes. A missing file gives
// an error that matches fs.ErrNotExist.
func (s *DiskStorage) Size(relPath string) (int64, error) {
	fi, err := s.root.Stat(relPath)
	if err != nil {
		return 0, fmt.Errorf("stat %q: %w", relPath, err)
	}
	return fi.Size(), nil
}

// Remove deletes the file relPath. A missing file is not an error.
func (s *DiskStorage) Remove(relPath string) error {
	if err := s.root.Remove(relPath); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return fmt.Errorf("remove %q: %w", relPath, err)
	}
	return nil
}

// RemoveDir deletes the directory relDir with all its content. A missing
// directory is not an error.
func (s *DiskStorage) RemoveDir(relDir string) error {
	if err := s.root.RemoveAll(relDir); err != nil {
		return fmt.Errorf("remove dir %q: %w", relDir, err)
	}
	return nil
}
