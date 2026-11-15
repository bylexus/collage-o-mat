package collage

import (
	"context"
	"errors"
	"fmt"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"collageomat/internal/apperr"
	"collageomat/internal/db"
	"collageomat/internal/jsoncol"
)

// GormStore is the database repository for collages. It is the only part of
// the package that uses GORM. All methods join the transaction of ctx, if
// any (see db.Transactor).
type GormStore struct {
	db *gorm.DB
}

// NewGormStore returns a store that uses db.
func NewGormStore(db *gorm.DB) *GormStore {
	return &GormStore{db: db}
}

// ListByUser returns the collages of a user, most recently updated first.
func (s *GormStore) ListByUser(ctx context.Context, userID uint) ([]Collage, error) {
	var collages []Collage
	err := db.Conn(ctx, s.db).
		Where("user_id = ?", userID).
		Order("updated_at DESC, id DESC").
		Find(&collages).Error
	if err != nil {
		return nil, fmt.Errorf("list collages of user %d: %w", userID, err)
	}
	return collages, nil
}

// OwnerByCollage returns the user id of every collage (collage id -> user
// id).
func (s *GormStore) OwnerByCollage(ctx context.Context) (map[uint]uint, error) {
	var rows []struct {
		ID     uint
		UserID uint
	}
	if err := db.Conn(ctx, s.db).Model(&Collage{}).Select("id, user_id").Scan(&rows).Error; err != nil {
		return nil, fmt.Errorf("list collage owners: %w", err)
	}
	owners := make(map[uint]uint, len(rows))
	for _, r := range rows {
		owners[r.ID] = r.UserID
	}
	return owners, nil
}

// FindForUser returns the collage with the given id if it belongs to the
// user. Otherwise it returns apperr.ErrNotFound.
func (s *GormStore) FindForUser(ctx context.Context, userID, id uint) (*Collage, error) {
	var c Collage
	err := db.Conn(ctx, s.db).
		Where("id = ? AND user_id = ?", id, userID).
		First(&c).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, apperr.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("load collage %d: %w", id, err)
	}
	return &c, nil
}

// Create inserts c and sets its ID and timestamps.
func (s *GormStore) Create(ctx context.Context, c *Collage) error {
	if err := db.Conn(ctx, s.db).Omit("User").Create(c).Error; err != nil {
		return fmt.Errorf("create collage: %w", err)
	}
	return nil
}

// UpdateName sets the name of c in the database and in c (also UpdatedAt).
func (s *GormStore) UpdateName(ctx context.Context, c *Collage, name string) error {
	if err := db.Conn(ctx, s.db).Model(c).Update("name", name).Error; err != nil {
		return fmt.Errorf("rename collage %d: %w", c.ID, err)
	}
	return nil
}

// UpdateSettingsForUser sets the settings (and UpdatedAt) of the collage
// with the given id if it belongs to the user. Otherwise it returns
// apperr.ErrNotFound.
func (s *GormStore) UpdateSettingsForUser(ctx context.Context, userID, id uint, settings jsoncol.JSON) error {
	res := db.Conn(ctx, s.db).Model(&Collage{}).
		Where("id = ? AND user_id = ?", id, userID).
		Update("settings", settings)
	if res.Error != nil {
		return fmt.Errorf("update settings of collage %d: %w", id, res.Error)
	}
	if res.RowsAffected == 0 {
		return apperr.ErrNotFound
	}
	return nil
}

// Delete deletes the collage row with the given id.
func (s *GormStore) Delete(ctx context.Context, id uint) error {
	if err := db.Conn(ctx, s.db).Delete(&Collage{}, id).Error; err != nil {
		return fmt.Errorf("delete collage %d: %w", id, err)
	}
	return nil
}

// ListTexts returns the texts of a collage in creation order (created_at,
// then id), never nil.
func (s *GormStore) ListTexts(ctx context.Context, collageID uint) ([]CollageText, error) {
	texts := []CollageText{}
	err := db.Conn(ctx, s.db).
		Where("collage_id = ?", collageID).
		Order("created_at ASC, id ASC").
		Find(&texts).Error
	if err != nil {
		return nil, fmt.Errorf("list texts of collage %d: %w", collageID, err)
	}
	return texts, nil
}

// TextIDsInOtherCollages returns those of ids that belong to a collage other
// than collageID.
func (s *GormStore) TextIDsInOtherCollages(ctx context.Context, collageID uint, ids []string) ([]string, error) {
	found := []string{}
	if len(ids) == 0 {
		return found, nil
	}
	err := db.Conn(ctx, s.db).Model(&CollageText{}).
		Where("id IN ? AND collage_id <> ?", ids, collageID).
		Order("id ASC").
		Pluck("id", &found).Error
	if err != nil {
		return nil, fmt.Errorf("find texts of other collages: %w", err)
	}
	return found, nil
}

// ReplaceTexts makes texts the complete text list of the collage: it
// creates the texts that do not exist, replaces the props of the existing
// ones and deletes the texts of the collage that are not in texts. The
// caller must make sure that no id of texts belongs to another collage; an
// upsert never changes a row of another collage. Run it in a transaction
// (see db.Transactor) so that the steps are atomic.
func (s *GormStore) ReplaceTexts(ctx context.Context, collageID uint, texts []CollageText) error {
	conn := db.Conn(ctx, s.db)
	ids := make([]string, len(texts))
	for i := range texts {
		texts[i].CollageID = collageID
		ids[i] = texts[i].ID
	}

	del := conn.Where("collage_id = ?", collageID)
	if len(ids) > 0 {
		del = del.Where("id NOT IN ?", ids)
	}
	if err := del.Delete(&CollageText{}).Error; err != nil {
		return fmt.Errorf("delete removed texts of collage %d: %w", collageID, err)
	}

	if len(texts) == 0 {
		return nil
	}
	upsert := clause.OnConflict{
		Columns:   []clause.Column{{Name: "id"}},
		DoUpdates: clause.AssignmentColumns([]string{"props", "updated_at"}),
		// Never take over a text of another collage.
		Where: clause.Where{Exprs: []clause.Expression{
			clause.Expr{SQL: "collage_texts.collage_id = excluded.collage_id"},
		}},
	}
	err := conn.Omit(clause.Associations).Clauses(upsert).CreateInBatches(texts, textBatchSize).Error
	if err != nil {
		return fmt.Errorf("save texts of collage %d: %w", collageID, err)
	}
	return nil
}

// textBatchSize is the number of rows per INSERT of ReplaceTexts (keeps the
// number of SQL parameters small).
const textBatchSize = 100
