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

func ReadKostenstellenCSV(file multipart.File) (kostenstellen []models.Kostenstellen, err error) {
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

	// Find the KstNr header row to understand the structure for cost center records
	var kstNrHeader []string
	for _, record := range records {
		if len(record) > 1 && record[3] == "KstNr" && record[0] == "0" {
			kstNrHeader = record[2:] // Skip the ID and type columns
			break
		}
	}

	if len(kstNrHeader) == 0 {
		return nil, fmt.Errorf("KstNr header row not found")
	}

	// Find column indices for cost center data
	verbBetrNrIndex := -1
	kstProjNrIndex := -1

	for i, col := range kstNrHeader {
		trimmedCol := strings.TrimSpace(col)
		if trimmedCol == "VerbBetrNr" {
			verbBetrNrIndex = i
		} else if trimmedCol == "KstProjNr" {
			kstProjNrIndex = i
		}
	}

	if verbBetrNrIndex == -1 {
		return nil, fmt.Errorf("VerbBetrNr column not found")
	}

	if kstProjNrIndex == -1 {
		return nil, fmt.Errorf("KstProjNr column not found")
	}

	// Process KO records (which are the cost center records we need)
	uniqueKstNrMap := []models.Kostenstellen{}

	for _, record := range records {
		if len(record) > 1 && record[3] == "KO" {
			var verbBetrNr string
			var kstProjNr string
			dataFields := record[2:] // Skip ID and type columns

			if verbBetrNrIndex >= 0 && verbBetrNrIndex < len(dataFields) {
				verbBetrNr = strings.TrimSpace(dataFields[verbBetrNrIndex])
			}

			if kstProjNrIndex >= 0 && kstProjNrIndex < len(dataFields) {
				kstProjNr = strings.TrimSpace(dataFields[kstProjNrIndex])
			}

			if verbBetrNr != "" && (strings.HasPrefix(verbBetrNr, "7") || verbBetrNr == "60000") {
				uniqueKstNrMap = append(uniqueKstNrMap, models.Kostenstellen{
					Kostenstellenummer: verbBetrNr,
					Bezeichnung:        kstProjNr,
				})
			}
		}
	}

	// Convert map keys to slice for return value
	uniqueKstNr := make([]models.Kostenstellen, 0, len(uniqueKstNrMap))
	for _, kst := range uniqueKstNrMap {
		kostenstelle := models.Kostenstellen{
			Kostenstellenummer: kst.Kostenstellenummer,
			Bezeichnung:        kst.Bezeichnung,
		}
		uniqueKstNr = append(uniqueKstNr, kostenstelle)
	}

	return uniqueKstNr, nil
}
