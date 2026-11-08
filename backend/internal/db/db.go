// Package db opens the SQLite database and migrates the models.
package db

import (
	"fmt"
	"log"
	"os"
	"time"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// pragmas are applied by the driver to every new connection of the pool.
// foreign_keys is a per-connection setting, so it must be in the DSN.
const pragmas = "?_pragma=foreign_keys(1)&_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)"

// Open opens (and creates if missing) the SQLite database at path, checks
// that foreign keys and WAL are active and runs AutoMigrate for models.
func Open(path string, models ...any) (*gorm.DB, error) {
	gdb, err := gorm.Open(sqlite.Open(path+pragmas), &gorm.Config{
		Logger: logger.New(log.New(os.Stderr, "gorm: ", log.LstdFlags), logger.Config{
			SlowThreshold:             500 * time.Millisecond,
			LogLevel:                  logger.Warn,
			IgnoreRecordNotFoundError: true,
		}),
	})
	if err != nil {
		return nil, fmt.Errorf("open database %q: %w", path, err)
	}

	if err := checkPragmas(gdb); err != nil {
		Close(gdb)
		return nil, err
	}

	if err := gdb.AutoMigrate(models...); err != nil {
		Close(gdb)
		return nil, fmt.Errorf("migrate database: %w", err)
	}
	return gdb, nil
}

// Close closes the underlying connection pool.
func Close(gdb *gorm.DB) {
	if sqlDB, err := gdb.DB(); err == nil {
		_ = sqlDB.Close()
	}
}

// checkPragmas verifies that the DSN pragmas are really active.
func checkPragmas(gdb *gorm.DB) error {
	var fk int
	if err := gdb.Raw("PRAGMA foreign_keys").Scan(&fk).Error; err != nil {
		return fmt.Errorf("read PRAGMA foreign_keys: %w", err)
	}
	if fk != 1 {
		return fmt.Errorf("sqlite foreign keys are not enabled (PRAGMA foreign_keys = %d)", fk)
	}
	var mode string
	if err := gdb.Raw("PRAGMA journal_mode").Scan(&mode).Error; err != nil {
		return fmt.Errorf("read PRAGMA journal_mode: %w", err)
	}
	if mode != "wal" {
		return fmt.Errorf("sqlite WAL mode is not active (PRAGMA journal_mode = %q)", mode)
	}
	return nil
}
