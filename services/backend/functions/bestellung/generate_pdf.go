package functions_bestellung

import (
	"fmt"
	"os"
	"strconv"
	"time"

	"justwms-backend/pkg/models"

	"codeberg.org/go-pdf/fpdf"
)

// getStatusColor returns RGB values for different status colors
func getStatusColor(status string) [3]int {
	switch status {
	case "bestellt":
		return [3]int{37, 99, 235} // Blue
	case "offen":
		return [3]int{245, 158, 11} // Orange
	case "abgeschlossen":
		return [3]int{34, 197, 94} // Green
	case "storniert":
		return [3]int{239, 68, 68} // Red
	default:
		return [3]int{107, 114, 128} // Gray
	}
}

func GenerateBestellungPDF(bestellung models.Bestellungen) (filePath string, err error) {
	const (
		colCount    = 4
		marginH     = 20.0
		lineHt      = 6.0
		cellGap     = 3.0
		primaryBlue = "#2563EB"
		lightGray   = "#F8FAFC"
		darkGray    = "#374151"
	)

	// Column widths for better proportions
	colWidths := [colCount]float64{25.0, 30.0, 55.0, 70.0} // Position, Anzahl, Artikelnummer, Bezeichnung

	type cellType struct {
		str  string
		list [][]byte
		ht   float64
	}
	var (
		cellList [colCount]cellType
		cell     cellType
	)

	pdf := fpdf.New("P", "mm", "A4", "") // 210 x 297
	header := [colCount]string{"Pos.", "Anzahl", "Artikelnummer", "Bezeichnung"}
	alignList := [colCount]string{"C", "C", "L", "L"}

	pdf.SetMargins(marginH, 20, marginH)
	pdf.AddPage()

	// Logo and Header Section
	logoPath := "./logo/justlab.png"
	if _, err := os.Stat(logoPath); err == nil {
		// Add logo (top right) - smaller size
		pdf.ImageOptions(logoPath, 155, 15, 25, 0, false, fpdf.ImageOptions{ImageType: "PNG", ReadDpi: true}, 0, "")
	}

	// Company Header
	pdf.SetFont("Arial", "B", 24)
	pdf.SetTextColor(55, 65, 81)
	pdf.CellFormat(0, 15, "JustWMS", "", 1, "L", false, 0, "")

	pdf.SetFont("Arial", "", 10)
	pdf.SetTextColor(107, 114, 128) // Gray color
	pdf.CellFormat(0, 5, "Warehouse Management System", "", 1, "L", false, 0, "")
	pdf.Ln(15)

	// Title Section with modern styling - smaller size
	pdf.SetFillColor(37, 99, 235) // Blue background
	pdf.Rect(marginH, pdf.GetY(), 170, 18, "F")

	pdf.SetFont("Arial", "B", 14)
	pdf.SetTextColor(255, 255, 255) // White text
	pdf.SetY(pdf.GetY() + 5)
	pdf.CellFormat(0, 8, fmt.Sprintf("BESTELLUNG %s", bestellung.ID.String()), "", 1, "L", false, 0, "")
	pdf.Ln(8)

	// Bestellung Info Section with modern cards
	pdf.SetFont("Arial", "B", 11)
	pdf.SetTextColor(55, 65, 81) // Dark gray

	// Info cards layout
	cardWidth := 85.0
	cardHeight := 35.0

	// Card 1: Bestellt von
	pdf.SetFillColor(248, 250, 252) // Light gray background
	pdf.RoundedRect(marginH, pdf.GetY(), cardWidth, cardHeight, 3, "1234", "F")
	pdf.SetXY(marginH+5, pdf.GetY()+5)
	pdf.SetFont("Arial", "B", 9)
	pdf.SetTextColor(107, 114, 128)
	pdf.Cell(0, 5, "BESTELLT VON")
	pdf.SetXY(marginH+5, pdf.GetY()+8)
	pdf.SetFont("Arial", "", 11)
	pdf.SetTextColor(55, 65, 81)
	pdf.Cell(0, 5, bestellung.BestelltVon)

	// Card 2: Bestellt am
	pdf.SetFillColor(248, 250, 252)
	pdf.RoundedRect(marginH+cardWidth+5, pdf.GetY()-13, cardWidth, cardHeight, 3, "1234", "F")
	pdf.SetXY(marginH+cardWidth+10, pdf.GetY()-8)
	pdf.SetFont("Arial", "B", 9)
	pdf.SetTextColor(107, 114, 128)
	pdf.Cell(0, 5, "BESTELLT AM")
	pdf.SetXY(marginH+cardWidth+10, pdf.GetY()+8)
	pdf.SetFont("Arial", "", 11)
	pdf.SetTextColor(55, 65, 81)
	pdf.Cell(0, 5, bestellung.BestelltAm)

	pdf.SetY(pdf.GetY() + 25)

	// Status badge - smaller size
	pdf.SetFont("Arial", "B", 9)
	statusColor := getStatusColor(bestellung.Status)
	pdf.SetFillColor(statusColor[0], statusColor[1], statusColor[2])
	pdf.SetTextColor(255, 255, 255)
	pdf.RoundedRect(marginH, pdf.GetY(), 50, 8, 4, "1234", "F")
	pdf.SetXY(marginH+3, pdf.GetY()+2)
	pdf.Cell(0, 4, fmt.Sprintf("STATUS: %s", bestellung.Status))

	pdf.Ln(20)

	// Modern Table Headers
	pdf.SetFont("Arial", "B", 11)
	pdf.SetTextColor(55, 65, 81)
	pdf.SetFillColor(241, 245, 249) // Very light blue-gray

	for colJ := 0; colJ < colCount; colJ++ {
		pdf.CellFormat(colWidths[colJ], 12, header[colJ], "1", 0, "C", true, 0, "")
	}
	pdf.Ln(-1)
	pdf.SetFont("Arial", "", 10)
	pdf.SetTextColor(55, 65, 81)
	pdf.SetFillColor(255, 255, 255)

	// Artikel Rows with alternating colors
	y := pdf.GetY()
	for rowJ, artikel := range bestellung.Artikel {
		maxHt := lineHt + 4 // Increased height for better readability

		// Prepare cell data
		rowData := [colCount]string{
			strconv.Itoa(rowJ + 1),       // Position
			strconv.Itoa(artikel.Anzahl), // Anzahl
			artikel.Artikelnummer,        // Artikelnummer
			artikel.Kurzname,             // Bezeichnung (Kurzname)
		}

		// Cell height calculation loop
		for colJ := 0; colJ < colCount; colJ++ {
			cell.str = rowData[colJ]
			cell.list = pdf.SplitLines([]byte(cell.str), colWidths[colJ]-cellGap-cellGap)
			cell.ht = float64(len(cell.list)) * lineHt
			if cell.ht > maxHt {
				maxHt = cell.ht
			}
			cellList[colJ] = cell
		}

		// Alternating row colors
		if rowJ%2 == 0 {
			pdf.SetFillColor(249, 250, 251) // Very light gray
		} else {
			pdf.SetFillColor(255, 255, 255) // White
		}

		// Cell render loop with modern styling
		x := marginH
		for colJ := 0; colJ < colCount; colJ++ {
			// Draw cell with subtle border
			pdf.SetDrawColor(226, 232, 240) // Light border
			pdf.Rect(x, y, colWidths[colJ], maxHt+cellGap+cellGap, "DF")

			cell = cellList[colJ]
			cellY := y + cellGap + (maxHt-cell.ht)/2
			for splitJ := 0; splitJ < len(cell.list); splitJ++ {
				pdf.SetXY(x+cellGap, cellY)
				pdf.CellFormat(colWidths[colJ]-cellGap-cellGap, lineHt, string(cell.list[splitJ]), "", 0,
					alignList[colJ], false, 0, "")
				cellY += lineHt
			}
			x += colWidths[colJ]
		}
		y += maxHt + cellGap + cellGap
	}

	// Footer section
	pdf.Ln(15)
	pdf.SetFont("Arial", "", 9)
	pdf.SetTextColor(107, 114, 128)
	pdf.CellFormat(0, 5, fmt.Sprintf("Generiert am: %s", time.Now().Format("02.01.2006 15:04")), "", 1, "C", false, 0, "")
	pdf.CellFormat(0, 5, "JustWMS - Warehouse Management System", "", 1, "C", false, 0, "")

	// Generate filename with bestellung ID
	filename := fmt.Sprintf("bestellung_%s.pdf", bestellung.ID.String())
	err = pdf.OutputFileAndClose(filename)
	if err != nil {
		return "", err
	}

	return filename, nil
}
