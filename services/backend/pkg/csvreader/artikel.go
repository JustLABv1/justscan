package csvreader

import (
	"bytes"
	"encoding/csv"
	"fmt"
	"io"
	"mime/multipart"
	"strings"
	"unicode/utf8"

	"justwms-backend/pkg/models"

	log "github.com/sirupsen/logrus"
	"golang.org/x/text/encoding/charmap"
	"golang.org/x/text/transform"
)

func ReadArtikelCSV(file multipart.File) (artikel []models.Artikel, err error) {
	// Read all file content first to handle encoding
	content, err := io.ReadAll(file)
	if err != nil {
		return nil, fmt.Errorf("failed to read file: %w", err)
	}

	// Remove UTF-8 BOM if present
	if len(content) >= 3 && content[0] == 0xEF && content[1] == 0xBB && content[2] == 0xBF {
		content = content[3:]
	}

	// Check if content is valid UTF-8, if not try to convert from Windows-1252
	var reader io.Reader
	if utf8.Valid(content) {
		reader = bytes.NewReader(content)
	} else {
		// Try to convert from Windows-1252 (common for German CSV files)
		decoder := charmap.Windows1252.NewDecoder()
		convertedContent, err := io.ReadAll(transform.NewReader(bytes.NewReader(content), decoder))
		if err != nil {
			log.Warnf("Failed to convert from Windows-1252, using original content: %v", err)
			reader = bytes.NewReader(content)
		} else {
			reader = bytes.NewReader(convertedContent)
		}
	}

	// Create a new CSV reader with semicolon delimiter
	csvReader := csv.NewReader(reader)
	csvReader.Comma = ';' // Use semicolon as delimiter instead of comma
	csvReader.LazyQuotes = true
	csvReader.FieldsPerRecord = -1 // Allow variable number of fields

	// Read all records from the CSV file
	records, err := csvReader.ReadAll()
	if err != nil {
		return nil, fmt.Errorf("failed to parse CSV: %w", err)
	}

	if len(records) == 0 {
		return nil, fmt.Errorf("CSV file is empty")
	}

	// Find the GERAETE header row to understand the structure for device records
	var nullHeader []string
	for _, record := range records {
		if len(record) > 1 && record[0] == "0" {
			nullHeader = record[1:] // Skip the ID and type columns
			break
		}
	}

	if len(nullHeader) == 0 {
		fmt.Println("No null header found")
		return
	}

	// Find column indices for device data
	betrNrIndex := -1
	kurznameIndex := -1
	artiIndex := -1

	for i, col := range nullHeader {
		trimmedCol := strings.TrimSpace(col)
		switch trimmedCol {
		case "BetrNr":
			betrNrIndex = i
		case "Kurzname":
			kurznameIndex = i
		case "ARTIKEL":
			artiIndex = i
		}
	}

	if betrNrIndex == -1 || kurznameIndex == -1 || artiIndex == -1 {
		fmt.Println("BetrNr, Kurzname or ARTIKEL column not found!")
		return
	}

	// Process KO records (which are the cost center records we need)
	uniqueArtikelMap := []models.Artikel{}

	for _, record := range records {
		if len(record) > 1 {
			var betrNr, kurzname, arti string
			dataFields := record[1:] // Skip ID and type columns

			if betrNrIndex >= 0 && betrNrIndex < len(dataFields) {
				betrNr = strings.TrimSpace(dataFields[betrNrIndex])
			}

			if kurznameIndex >= 0 && kurznameIndex < len(dataFields) {
				kurzname = strings.TrimSpace(dataFields[kurznameIndex])
			}

			if artiIndex >= 0 && artiIndex < len(dataFields) {
				arti = strings.TrimSpace(dataFields[artiIndex])
			}

			if betrNr != "" && betrNr != "*" && betrNr != "BetrNr" && betrNr != "StammTyp" && betrNr != "SetBetrNr" && betrNr != "ME" && kurzname != "" && arti != "" && arti != "ART" {
				uniqueArtikelMap = append(uniqueArtikelMap, models.Artikel{
					Betriebsnummer: betrNr,
					Kurzname:       kurzname,
					Artikel:        arti,
				})
			}
		}
	}

	// Convert map keys to slice for return value
	uniqueArtikel := make([]models.Artikel, 0, len(uniqueArtikelMap))
	for _, art := range uniqueArtikelMap {
		artikel := models.Artikel{
			Artikel:        art.Artikel,
			Betriebsnummer: art.Betriebsnummer,
			Kurzname:       art.Kurzname,
		}
		uniqueArtikel = append(uniqueArtikel, artikel)
	}

	return uniqueArtikel, nil
}
