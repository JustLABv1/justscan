package router

import (
	"context"
	"errors"
	"io"
	iofs "io/fs"
	"net/http"
	"os"
	"path"
	"strings"
	"sync"

	"justscan-backend/docs"

	"github.com/gin-gonic/gin"
	swaggerfiles "github.com/swaggo/files/v2"
	ginSwagger "github.com/swaggo/gin-swagger"
	"golang.org/x/net/webdav"
)

var (
	swaggerV2HandlerOnce sync.Once
	swaggerV2Handler     *webdav.Handler
)

func Swagger(router *gin.Engine) {
	router.GET("/api/v1/swagger/doc.json", func(c *gin.Context) {
		c.JSON(http.StatusOK, docs.OpenAPISpec(router.Routes()))
	})
	router.GET("/swagger/*any", ginSwagger.WrapHandler(getSwaggerV2Handler(), ginSwagger.URL("/api/v1/swagger/doc.json")))
}

func getSwaggerV2Handler() *webdav.Handler {
	swaggerV2HandlerOnce.Do(func() {
		memFS := webdav.NewMemFS()
		ctx := context.Background()

		err := iofs.WalkDir(swaggerfiles.FS, ".", func(entryPath string, d iofs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if d.IsDir() {
				return nil
			}

			targetPath := "/" + strings.TrimLeft(path.Clean(entryPath), "/")
			if err := mkdirAllWebDAV(ctx, memFS, path.Dir(targetPath)); err != nil {
				return err
			}

			src, err := swaggerfiles.FS.Open(entryPath)
			if err != nil {
				return err
			}
			defer src.Close()

			dst, err := memFS.OpenFile(ctx, targetPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
			if err != nil {
				return err
			}

			if _, err := io.Copy(dst, src); err != nil {
				_ = dst.Close()
				return err
			}

			return dst.Close()
		})
		if err != nil {
			panic(err)
		}

		swaggerV2Handler = &webdav.Handler{
			FileSystem: memFS,
			LockSystem: webdav.NewMemLS(),
		}
	})

	return swaggerV2Handler
}

func mkdirAllWebDAV(ctx context.Context, fs webdav.FileSystem, dir string) error {
	if dir == "" || dir == "." || dir == "/" {
		return nil
	}

	parts := strings.Split(strings.Trim(dir, "/"), "/")
	current := ""
	for _, part := range parts {
		current += "/" + part
		if err := fs.Mkdir(ctx, current, 0o755); err != nil && !errors.Is(err, os.ErrExist) {
			return err
		}
	}

	return nil
}
