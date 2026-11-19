package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"os"

	"collageomat/internal/auth"
	"collageomat/internal/config"
	"collageomat/internal/db"
	"collageomat/internal/photo"
	"collageomat/internal/quota"
	"collageomat/internal/settings"
)

// runPhotos dispatches the "photos" subcommands.
func runPhotos(args []string) error {
	if len(args) == 0 {
		fmt.Fprint(os.Stderr, usage)
		return errors.New("photos: no subcommand given (recalc-size)")
	}
	switch args[0] {
	case "recalc-size":
		return runPhotosRecalcSize(args[1:])
	default:
		fmt.Fprint(os.Stderr, usage)
		return fmt.Errorf("photos: unknown subcommand %q", args[0])
	}
}

// runPhotosRecalcSize sets the stored size of the photos of one user (or of
// all users) to the size of the files on disk and prints a summary per user.
// It may run while the server runs.
func runPhotosRecalcSize(args []string) error {
	flags := flag.NewFlagSet("photos recalc-size", flag.ContinueOnError)
	username := flags.String("username", "", "name of the user")
	all := flags.Bool("all", false, "all users")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if (*username == "") == !*all {
		fmt.Fprint(os.Stderr, usage)
		return errors.New("photos recalc-size: give either --username or --all")
	}
	name := ""
	if !*all {
		var err error
		if name, err = auth.NormalizeUsername(*username); err != nil {
			return err
		}
	}

	cfg, err := config.FromEnv()
	if err != nil {
		return err
	}
	gdb, err := openDB(cfg)
	if err != nil {
		return err
	}
	defer db.Close(gdb)
	files, err := photo.NewDiskStorage(cfg.PhotosDir())
	if err != nil {
		return err
	}
	defer files.Close()

	ctx := context.Background()
	photoStore := photo.NewGormStore(gdb)
	quotas := quota.NewService(quota.NewGormStore(gdb), photoStore, settings.NewService(settings.NewGormStore(gdb)))
	results, err := photo.RecalcSizes(ctx, photoStore, files, name)
	if err != nil {
		return err
	}
	for _, r := range results {
		for _, f := range r.MissingFiles {
			fmt.Fprintf(os.Stderr, "warning: user %q: photo file %q is missing, size not changed\n", r.Username, f)
		}
		limit, err := quotas.Limit(ctx, r.UserID)
		if err != nil {
			return err
		}
		fmt.Printf("%s: %d updated, %d unchanged, %d missing, used %s (%d bytes) / %s\n",
			r.Username, r.Updated, r.Unchanged, r.Missing, quota.FormatBytes(r.UsedBytes), r.UsedBytes,
			quota.FormatLimit(limit))
	}
	return nil
}
