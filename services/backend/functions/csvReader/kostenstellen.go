package csvreader

import (
	"encoding/csv"
	"fmt"
	"mime/multipart"
	"strings"

	log "github.com/sirupsen/logrus"
)

func ReadKostenstellenCSV(file multipart.File) (kostenstellen []string, err error) {
	// Create a new CSV reader with semicolon delimiter
	reader := csv.NewReader(file)
	reader.Comma = ';' // Use semicolon as delimiter instead of comma
	reader.LazyQuotes = true
	reader.FieldsPerRecord = -1 // Allow variable number of fields

	// Read all records from the CSV file
	records, err := reader.ReadAll()
	if err != nil {
		log.Fatal(err)
	}

	if len(records) == 0 {
		return nil, fmt.Errorf("CSV file is empty")
	}

	// Find the KOSTENST header row to understand the structure for cost center records
	var kostenstHeader []string
	for _, record := range records {
		if len(record) > 1 && record[1] == "KOSTENST" && record[0] == "0" {
			kostenstHeader = record[2:] // Skip the ID and type columns
			break
		}
	}

	if len(kostenstHeader) == 0 {
		return nil, fmt.Errorf("KOSTENST header row not found")
	}

	// Find column indices for cost center data
	kstNrIndex := -1

	for i, col := range kostenstHeader {
		trimmedCol := strings.TrimSpace(col)
		if trimmedCol == "KstNr" {
			kstNrIndex = i
			break
		}
	}

	if kstNrIndex == -1 {
		return nil, fmt.Errorf("KstNr column not found")
	}

	// Process KO records (which are the cost center records we need)
	uniqueKstNrMap := make(map[string]bool) // Use a map to track unique values

	for _, record := range records {
		if len(record) > 1 && record[1] == "KO" {
			var kstNr string
			dataFields := record[2:] // Skip ID and type columns

			if kstNrIndex >= 0 && kstNrIndex < len(dataFields) {
				kstNr = strings.TrimSpace(dataFields[kstNrIndex])
			}

			if kstNr != "" {
				uniqueKstNrMap[kstNr] = true // Add to map for uniqueness
			}
		}
	}

	// Convert map keys to slice for return value
	uniqueKstNr := make([]string, 0, len(uniqueKstNrMap))
	for kstNr := range uniqueKstNrMap {
		uniqueKstNr = append(uniqueKstNr, kstNr)
	}

	return uniqueKstNr, nil
}
