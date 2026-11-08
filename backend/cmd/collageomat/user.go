package main

import (
	"bufio"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"

	"golang.org/x/term"

	"collageomat/internal/auth"
	"collageomat/internal/config"
	"collageomat/internal/db"
)

// runUser dispatches the "user" subcommands.
func runUser(args []string) error {
	if len(args) == 0 {
		fmt.Fprint(os.Stderr, usage)
		return errors.New("user: no subcommand given (add, passwd)")
	}
	switch args[0] {
	case "add":
		return runUserAdd(args[1:])
	case "passwd":
		return runUserPasswd(args[1:])
	default:
		fmt.Fprint(os.Stderr, usage)
		return fmt.Errorf("user: unknown subcommand %q", args[0])
	}
}

func runUserAdd(args []string) error {
	flags := flag.NewFlagSet("user add", flag.ContinueOnError)
	username := flags.String("username", "", "name of the new user")
	admin := flags.Bool("admin", false, "give the user the admin role")
	if err := flags.Parse(args); err != nil {
		return err
	}
	name, err := auth.NormalizeUsername(*username)
	if err != nil {
		return err
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

	password, err := readNewPassword()
	if err != nil {
		return err
	}
	user, err := auth.CreateUser(gdb, name, password, *admin)
	if err != nil {
		return err
	}
	role := "user"
	if user.IsAdmin {
		role = "admin"
	}
	fmt.Printf("created %s %q (id %d)\n", role, user.Username, user.ID)
	return nil
}

func runUserPasswd(args []string) error {
	flags := flag.NewFlagSet("user passwd", flag.ContinueOnError)
	username := flags.String("username", "", "name of the user")
	if err := flags.Parse(args); err != nil {
		return err
	}
	name, err := auth.NormalizeUsername(*username)
	if err != nil {
		return err
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

	password, err := readNewPassword()
	if err != nil {
		return err
	}
	if err := auth.SetPassword(gdb, name, password); err != nil {
		return err
	}
	fmt.Printf("password changed for %q, all sessions deleted\n", name)
	return nil
}

// readNewPassword asks for the password twice. On a terminal the input is
// not echoed. If stdin is not a terminal, it reads two lines from stdin, so
// the command can be scripted: printf 'pw\npw\n' | collageomat user add ...
func readNewPassword() (string, error) {
	var first, second string
	var err error

	fd := int(os.Stdin.Fd())
	if term.IsTerminal(fd) {
		if first, err = promptNoEcho(fd, "Password: "); err != nil {
			return "", err
		}
		if second, err = promptNoEcho(fd, "Repeat password: "); err != nil {
			return "", err
		}
	} else {
		in := bufio.NewReader(os.Stdin)
		if first, err = readLine(in); err != nil {
			return "", fmt.Errorf("read password: %w", err)
		}
		if second, err = readLine(in); err != nil {
			return "", fmt.Errorf("read password repeat: %w", err)
		}
	}

	if first != second {
		return "", errors.New("passwords do not match")
	}
	if err := auth.ValidatePassword(first); err != nil {
		return "", err
	}
	return first, nil
}

func promptNoEcho(fd int, prompt string) (string, error) {
	fmt.Fprint(os.Stderr, prompt)
	b, err := term.ReadPassword(fd)
	fmt.Fprintln(os.Stderr)
	if err != nil {
		return "", fmt.Errorf("read password: %w", err)
	}
	return string(b), nil
}

// readLine reads one line without the line ending. A last line without a
// newline is accepted.
func readLine(in *bufio.Reader) (string, error) {
	line, err := in.ReadString('\n')
	if err != nil && !(errors.Is(err, io.EOF) && line != "") {
		return "", err
	}
	return strings.TrimRight(line, "\r\n"), nil
}
