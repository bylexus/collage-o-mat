package db

import (
	"context"

	"gorm.io/gorm"
)

// txKey is the context key of the transaction started by Transactor.InTx.
type txKey struct{}

// Transactor runs functions in one database transaction (unit of work).
// Services use it through a small interface they declare themselves, so
// they do not depend on GORM. Stores join the transaction with Conn.
type Transactor struct {
	db *gorm.DB
}

// NewTransactor returns a Transactor that uses gdb.
func NewTransactor(gdb *gorm.DB) *Transactor {
	return &Transactor{db: gdb}
}

// InTx calls fn in one transaction. The context passed to fn carries the
// transaction; all store calls with this context use it (see Conn). If fn
// returns an error, the transaction is rolled back, else it is committed.
// A nested call uses a savepoint of the outer transaction.
func (t *Transactor) InTx(ctx context.Context, fn func(ctx context.Context) error) error {
	return Conn(ctx, t.db).Transaction(func(tx *gorm.DB) error {
		return fn(context.WithValue(ctx, txKey{}, tx))
	})
}

// Conn returns the connection a store must use for ctx: the transaction of
// InTx if ctx carries one, else gdb. The result is bound to ctx.
func Conn(ctx context.Context, gdb *gorm.DB) *gorm.DB {
	if tx, ok := ctx.Value(txKey{}).(*gorm.DB); ok {
		return tx.WithContext(ctx)
	}
	return gdb.WithContext(ctx)
}
