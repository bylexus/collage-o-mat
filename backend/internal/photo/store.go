package photo

import (
	"context"
	"errors"
	"fmt"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"collageomat/internal/apperr"
)

// GormStore is the database repository for photos. It is the only part of
// the package that uses GORM. It does not check ownership; the service does.
type GormStore struct {
	db *gorm.DB
}

// NewGormStore returns a store that uses db.
func NewGormStore(db *gorm.DB) *GormStore {
	return &GormStore{db: db}
}

// CreateWithFile inserts p and then calls writeFile with p.ID set;
// writeFile sets p.FileName and writes the file. Then FileName is saved.
// All database changes are one transaction: if writeFile or a database step
// fails, no row is left. writeFile is not undone by the store.
func (s *GormStore) CreateWithFile(ctx context.Context, p *Photo, writeFile func(p *Photo) error) error {
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Omit(clause.Associations).Create(p).Error; err != nil {
			return fmt.Errorf("create photo: %w", err)
		}
		if err := writeFile(p); err != nil {
			return err
		}
		if err := tx.Model(p).Update("file_name", p.FileName).Error; err != nil {
			return fmt.Errorf("set file name of photo %d: %w", p.ID, err)
		}
		return nil
	})
}

// FindInCollage returns the photo id of the collage, or apperr.ErrNotFound.
func (s *GormStore) FindInCollage(ctx context.Context, collageID, id uint) (*Photo, error) {
	var p Photo
	err := s.db.WithContext(ctx).Where("id = ? AND collage_id = ?", id, collageID).Take(&p).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, apperr.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("load photo %d: %w", id, err)
	}
	return &p, nil
}

// ListByCollage returns the photos of a collage, id ascending.
func (s *GormStore) ListByCollage(ctx context.Context, collageID uint) ([]Photo, error) {
	var photos []Photo
	err := s.db.WithContext(ctx).Where("collage_id = ?", collageID).Order("id ASC").Find(&photos).Error
	if err != nil {
		return nil, fmt.Errorf("list photos of collage %d: %w", collageID, err)
	}
	return photos, nil
}

// ExistingSourceAssetIDs returns those of assetIDs that are already in the
// collage from the connector.
func (s *GormStore) ExistingSourceAssetIDs(ctx context.Context, collageID, connectorID uint, assetIDs []string) ([]string, error) {
	var existing []string
	err := s.db.WithContext(ctx).Model(&Photo{}).
		Where("collage_id = ? AND connector_id = ? AND source_asset_id IN ?", collageID, connectorID, assetIDs).
		Pluck("source_asset_id", &existing).Error
	if err != nil {
		return nil, fmt.Errorf("find imported assets of collage %d: %w", collageID, err)
	}
	return existing, nil
}

// CountByCollages returns the number of photos per collage id; collages
// without photos are missing in the map.
func (s *GormStore) CountByCollages(ctx context.Context, collageIDs []uint) (map[uint]int, error) {
	counts := make(map[uint]int, len(collageIDs))
	if len(collageIDs) == 0 {
		return counts, nil
	}
	var rows []struct {
		CollageID uint
		Count     int
	}
	err := s.db.WithContext(ctx).Model(&Photo{}).
		Select("collage_id, COUNT(*) AS count").
		Where("collage_id IN ?", collageIDs).
		Group("collage_id").
		Scan(&rows).Error
	if err != nil {
		return nil, fmt.Errorf("count photos of collages: %w", err)
	}
	for _, r := range rows {
		counts[r.CollageID] = r.Count
	}
	return counts, nil
}

// Delete deletes the photo row with the given id.
func (s *GormStore) Delete(ctx context.Context, id uint) error {
	if err := s.db.WithContext(ctx).Delete(&Photo{}, id).Error; err != nil {
		return fmt.Errorf("delete photo %d: %w", id, err)
	}
	return nil
}

// DeleteByCollage deletes all photo rows of a collage.
func (s *GormStore) DeleteByCollage(ctx context.Context, collageID uint) error {
	if err := s.db.WithContext(ctx).Where("collage_id = ?", collageID).Delete(&Photo{}).Error; err != nil {
		return fmt.Errorf("delete photos of collage %d: %w", collageID, err)
	}
	return nil
}
