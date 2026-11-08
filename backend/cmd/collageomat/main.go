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
	"collageomat/internal/config"
	"collageomat/internal/db"
	"collageomat/internal/httpapi"
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

	static, err := web.NewHandler()
	if err != nil {
		return err
	}

	srv := &http.Server{
		Addr:              cfg.Listen,
		Handler:           httpapi.NewRouter(static, authHandler.RequireAuth, authHandler),
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
	}
}

// openDB creates the data dir if needed, opens the database and migrates
// all models.
func openDB(cfg config.Config) (*gorm.DB, error) {
	if err := cfg.EnsureDataDir(); err != nil {
		return nil, err
	}
	return db.Open(cfg.DBPath(), models()...)
}
