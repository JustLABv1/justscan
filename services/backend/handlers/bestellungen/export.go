package bestellungen

import (
	"fmt"

	"justwms-backend/config"
	functions_bestellung "justwms-backend/functions/bestellung"
	"justwms-backend/functions/httperror"
	"justwms-backend/pkg/models"

	"github.com/gin-gonic/gin"
	_ "github.com/lib/pq"
	"github.com/uptrace/bun"
)

func Export(context *gin.Context, db *bun.DB, config *config.RestfulConf) {
	bestellungID := context.Param("id")

	// get bestellung von db
	var bestellung models.Bestellungen
	err := db.NewSelect().Model(&bestellung).Where("id = ?", bestellungID).Scan(context)
	if err != nil {
		httperror.InternalServerError(context, "Error collecting bestellung data from db", err)
		return
	}

	// Generate PDF and get the file path
	pdfPath, err := functions_bestellung.GenerateBestellungPDF(bestellung, config)
	if err != nil {
		httperror.InternalServerError(context, "Error generating PDF", err)
		return
	}

	// Set headers for PDF download
	filename := fmt.Sprintf("bestellung_%s.pdf", bestellung.ID.String())
	context.Header("Content-Description", "File Transfer")
	context.Header("Content-Transfer-Encoding", "binary")
	context.Header("Content-Disposition", fmt.Sprintf("attachment; filename=%s", filename))
	context.Header("Content-Type", "application/pdf")

	// Send the PDF file
	context.File(pdfPath)
}
