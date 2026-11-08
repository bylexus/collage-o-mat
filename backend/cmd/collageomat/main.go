// Command collageomat is the Collage-o-mat server and admin CLI.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"gorm.io/gorm"

	"collageomat/internal/auth"
	"collageomat/internal/collage"
	"collageomat/internal/config"
	"collageomat/internal/connector"
	"collageomat/internal/connector/immich"
	"collageomat/internal/db"
	"collageomat/internal/httpapi"
	"collageomat/internal/photo"
	"collageomat/internal/secretbox"
	"collageomat/internal/web"
)

const usage = `Usage: collageomat <command> [flags]

Commands:
  serve                                   start the HTTP server
  user add --username <name> [--admin]    create a user (asks for the password)
  user passwd --username <name>           set a new password (asks for it, logs the user out)
`

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}

// run dispatches to the subcommand named by the first argument.
func run(args []string) error {
	if len(args) == 0 {
		fmt.Fprint(os.Stderr, usage)
		return errors.New("no command given")
	}
	switch args[0] {
	case "serve":
		return runServe(args[1:])
	case "user":
		return runUser(args[1:])
	case "help", "-h", "--help":
		fmt.Fprint(os.Stdout, usage)
		return nil
	default:
		fmt.Fprint(os.Stderr, usage)
		return fmt.Errorf("unknown command %q", args[0])
	}
}

func runServe(args []string) error {
	flags := flag.NewFlagSet("serve", flag.ContinueOnError)
	if err := flags.Parse(args); err != nil {
		return err
	}

	cfg, err := config.FromEnv()
	if err != nil {
		return err
	}
	if err := cfg.RequireSecret(); err != nil {
		return err
	}

	gdb, err := openDB(cfg)
	if err != nil {
		return err
	}
	defer db.Close(gdb)

	authHandler, err := auth.NewHandler(gdb, cfg.CookieSecure)
	if err != nil {
		return err
	}

	photoFiles, err := photo.NewDiskStorage(cfg.PhotosDir())
	if err != nil {
		return err
	}
	defer photoFiles.Close()

	domainModules, err := newDomainModules(cfg.Secret, gdb, photoFiles)
	if err != nil {
		return err
	}
	modules := append([]httpapi.Module{authHandler}, domainModules...)

	static, err := web.NewHandler()
	if err != nil {
		return err
	}

	srv := &http.Server{
		Addr:              cfg.Listen,
		Handler:           httpapi.NewRouter(static, authHandler.RequireAuth, modules...),
		ReadHeaderTimeout: 10 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	errCh := make(chan error, 1)
	go func() {
		slog.Info("server listening", "addr", cfg.Listen, "dataDir", cfg.DataDir)
		errCh <- srv.ListenAndServe()
	}()

	select {
	case err := <-errCh:
		return err
	case <-ctx.Done():
	}

	slog.Info("shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		return err
	}
	if err := <-errCh; err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

// models returns all GORM models for AutoMigrate. Later steps add their
// models here.
func models() []any {
	return []any{
		&auth.User{},
		&auth.Session{},
		&collage.Collage{},
		&connector.Connector{},
		&photo.Photo{},
	}
}

// newDomainModules wires the services and handlers of the domain packages
// (collages, connectors, Immich, photos). Connector configs are encrypted
// with a key derived from secret; photo files are stored in photoFiles.
func newDomainModules(secret string, gdb *gorm.DB, photoFiles *photo.DiskStorage) ([]httpapi.Module, error) {
	immichKind := immich.NewKind(nil)
	connectorSvc, err := newConnectorService(secret, gdb, immichKind)
	if err != nil {
		return nil, err
	}
	immichSvc := immich.NewService(connectorSvc, immichKind)

	photoStore := photo.NewGormStore(gdb)
	collageSvc := collage.NewService(
		collage.NewGormStore(gdb),
		photo.NewCollagePhotos(photoStore, photoFiles),
		db.NewTransactor(gdb),
	)
	photoSvc := photo.NewService(photoStore, photoFiles, collageSvc, immichSvc)

	return []httpapi.Module{
		collage.NewHandler(collageSvc),
		photo.NewHandler(photoSvc),
		connector.NewHandler(connectorSvc),
		immich.NewHandler(immichSvc),
	}, nil
}

// newConnectorService returns the connector service with all connector
// kinds registered.
func newConnectorService(secret string, gdb *gorm.DB, kinds ...connector.Kind) (*connector.Service, error) {
	box, err := secretbox.New(secret)
	if err != nil {
		return nil, err
	}
	registry, err := connector.NewRegistry(kinds...)
	if err != nil {
		return nil, err
	}
	return connector.NewService(connector.NewGormStore(gdb), box, registry), nil
}

// openDB creates the data dir if needed, opens the database and migrates
// all models.
func openDB(cfg config.Config) (*gorm.DB, error) {
	if err := cfg.EnsureDataDir(); err != nil {
		return nil, err
	}
	return db.Open(cfg.DBPath(), models()...)
}
