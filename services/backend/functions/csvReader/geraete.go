package csvreader

import (
	"bytes"
	"encoding/csv"
	"fmt"
	"io"
	"mime/multipart"
	"strings"
	"unicode/utf8"

	"github.com/JustNZ/JustWMS/services/backend/pkg/models"

	log "github.com/sirupsen/logrus"
	"golang.org/x/text/encoding/charmap"
	"golang.org/x/text/transform"
)

func ReadGeraeteCSV(file multipart.File) (geraete []models.Geraete, err error) {
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
	var geraeteHeader []string
	for _, record := range records {
		if len(record) > 1 && record[1] == "GERAETE" && record[0] == "0" {
			geraeteHeader = record[2:] // Skip the ID and type columns
			break
		}
	}

	if len(geraeteHeader) == 0 {
		fmt.Println("No GERAETE header found")
		return
	}

	// Find column indices for device data
	betrNrIndex := -1
	gerNrIndex := -1
	kurznameIndex := -1

	for i, col := range geraeteHeader {
		trimmedCol := strings.TrimSpace(col)
		if trimmedCol == "BetrNr" {
			betrNrIndex = i
		} else if trimmedCol == "GerNr" {
			gerNrIndex = i
		} else if trimmedCol == "Kurzname" {
			kurznameIndex = i
		}
	}

	if betrNrIndex == -1 || gerNrIndex == -1 || kurznameIndex == -1 {
		fmt.Println("BetrNr, GerNr or Kurzname column not found!")
		return
	}

	// Process KO records (which are the cost center records we need)
	uniqueGeraeteMap := []models.Geraete{}

	for _, record := range records {
		if len(record) > 1 {
			var gerNr, betrNr, kurzname string
			dataFields := record[2:] // Skip ID and type columns

			if gerNrIndex >= 0 && gerNrIndex < len(dataFields) {
				gerNr = strings.TrimSpace(dataFields[gerNrIndex])
			}
			if betrNrIndex >= 0 && betrNrIndex < len(dataFields) {
				betrNr = strings.TrimSpace(dataFields[betrNrIndex])
			}
			if kurznameIndex >= 0 && kurznameIndex < len(dataFields) {
				kurzname = strings.TrimSpace(dataFields[kurznameIndex])
			}

			if gerNr != "" && betrNr != "" && kurzname == "0" {
				uniqueGeraeteMap = append(uniqueGeraeteMap, models.Geraete{
					Gerätenummer:   gerNr,
					Betriebsnummer: betrNr,
				})
			}
		}
	}

	// Convert map keys to slice for return value
	uniqueGeraete := make([]models.Geraete, 0, len(uniqueGeraeteMap))
	for _, ger := range uniqueGeraeteMap {
		geraet := models.Geraete{
			Gerätenummer:   ger.Gerätenummer,
			Betriebsnummer: ger.Betriebsnummer,
		}
		uniqueGeraete = append(uniqueGeraete, geraet)
	}

	return uniqueGeraete, nil
}
