package scanner

import (
	"context"

	"github.com/google/uuid"
)

type xrayContextKey int

const (
	xrayScanIDKey     xrayContextKey = iota
	xrayRegistryIDKey xrayContextKey = iota
)

// xrayScanContext returns a new context that carries the scan and registry IDs
// for xRay request logging.
func xrayScanContext(ctx context.Context, scanID uuid.UUID, registryID *uuid.UUID) context.Context {
	ctx = context.WithValue(ctx, xrayScanIDKey, scanID)
	if registryID != nil {
		ctx = context.WithValue(ctx, xrayRegistryIDKey, *registryID)
	}
	return ctx
}

func xrayScanIDFromContext(ctx context.Context) *uuid.UUID {
	if v, ok := ctx.Value(xrayScanIDKey).(uuid.UUID); ok && v != uuid.Nil {
		cp := v
		return &cp
	}
	return nil
}

func xrayRegistryIDFromContext(ctx context.Context) *uuid.UUID {
	if v, ok := ctx.Value(xrayRegistryIDKey).(uuid.UUID); ok && v != uuid.Nil {
		cp := v
		return &cp
	}
	return nil
}
