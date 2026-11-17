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

	"collageomat/internal/admin"
	"collageomat/internal/auth"
	"collageomat/internal/collage"
	"collageomat/internal/config"
	"collageomat/internal/connector"
	"collageomat/internal/connector/googlephotos"
	"collageomat/internal/connector/immich"
	"collageomat/internal/connector/synology"
	"collageomat/internal/db"
	"collageomat/internal/httpapi"
	"collageomat/internal/imaging"
	"collageomat/internal/photo"
	"collageomat/internal/profile"
	"collageomat/internal/secretbox"
	"collageomat/internal/settings"
	"collageomat/internal/web"
)

// maxConcurrentDecodes is the server-wide number of images (uploads) that
// are decoded and processed at the same time.
const maxConcurrentDecodes = 2

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

	// One limiter for failed logins and wrong current passwords (password
	// change): both share the counter per (username, client IP).
	loginLimiter := auth.NewLoginLimiter(time.Now)
	// One limiter for all image decodes of the server (photos and avatars).
	decoder := imaging.NewDecodeLimiter(maxConcurrentDecodes)
	// The profile service is created before the auth handler: it gives the
	// avatar version of the user DTO (auth.AvatarVersions).
	profileSvc := profile.NewService(
		profile.NewGormStore(gdb), auth.NewPasswordChanger(gdb, loginLimiter), decoder,
	)
	authHandler, err := auth.NewHandler(
		gdb, auth.CookieOptions{Name: cfg.CookieName, Secure: cfg.CookieSecure}, loginLimiter, profileSvc,
	)
	if err != nil {
		return err
	}

	photoFiles, err := photo.NewDiskStorage(cfg.PhotosDir())
	if err != nil {
		return err
	}
	defer photoFiles.Close()

	domainModules, err := newDomainModules(cfg.Secret, gdb, photoFiles, decoder, profileSvc, authHandler.RequireAdmin)
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
		&collage.CollageText{},
		&connector.Connector{},
		&photo.Photo{},
		&profile.Avatar{},
		&settings.SystemSetting{},
	}
}

// newDomainModules wires the services and handlers of the domain packages
// (collages, connectors, Immich, Synology, Google Photos, photos, profile,
// admin, settings).
// Connector configs are encrypted with a key derived from secret; photo
// files are stored in photoFiles; decoder is the server-wide image decode
// limiter; profileSvc is created earlier because the auth handler needs it
// too; requireAdmin protects the admin routes (behind requireAuth).
func newDomainModules(
	secret string, gdb *gorm.DB, photoFiles *photo.DiskStorage, decoder *imaging.DecodeLimiter,
	profileSvc *profile.Service, requireAdmin httpapi.Middleware,
) ([]httpapi.Module, error) {
	immichKind := immich.NewKind(nil)
	synologyKind := synology.NewKind()
	googlePhotosKind := googlephotos.NewKind()
	connectorSvc, err := newConnectorService(secret, gdb, immichKind, synologyKind, googlePhotosKind)
	if err != nil {
		return nil, err
	}
	immichSvc := immich.NewService(connectorSvc, immichKind)
	synologySvc := synology.NewService(connectorSvc, synologyKind)
	googlePhotosSvc := googlephotos.NewService(connectorSvc)

	tx := db.NewTransactor(gdb)
	photoStore := photo.NewGormStore(gdb)
	collageStore := collage.NewGormStore(gdb)
	collagePhotos := photo.NewCollagePhotos(photoStore, photoFiles)
	collageSvc := collage.NewService(collageStore, collagePhotos, tx)
	photoSources := photo.NewSourcesByType(connectorSvc, map[string]photo.Sources{
		immich.Type:       immichSvc,
		synology.Type:     synologySvc,
		googlephotos.Type: googlePhotosSvc,
	})
	photoSvc := photo.NewService(photoStore, photoFiles, collageSvc, photoSources, decoder)
	adminSvc := admin.NewService(
		admin.NewGormStore(gdb), collageSvc, collage.NewUserUsage(collageStore, collagePhotos), profileSvc, tx,
	)
	settingsSvc := settings.NewService(settings.NewGormStore(gdb))

	return []httpapi.Module{
		collage.NewHandler(collageSvc),
		photo.NewHandler(photoSvc),
		connector.NewHandler(connectorSvc),
		immich.NewHandler(immichSvc),
		synology.NewHandler(synologySvc),
		googlephotos.NewHandler(googlePhotosSvc),
		profile.NewHandler(profileSvc),
		admin.NewHandler(adminSvc, requireAdmin),
		settings.NewHandler(settingsSvc, requireAdmin),
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
