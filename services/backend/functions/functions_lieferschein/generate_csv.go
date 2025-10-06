package functions_lieferschein

import (
	"encoding/csv"
	"fmt"
	"justwms-backend/config"
	"justwms-backend/pkg/models"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func GenerateLieferscheinCSV(lieferschein models.Lieferschein, config *config.RestfulConf) (string, error) {
	// Create the CSV filename
	filename := fmt.Sprintf("lieferschein_%s.csv", lieferschein.ID.String())
	filePath := filepath.Join(config.Lieferschein.ExportPath, "/", filename)

	// create folder if not exists
	if _, err := os.Stat(config.Lieferschein.ExportPath); os.IsNotExist(err) {
		err := os.MkdirAll(config.Lieferschein.ExportPath, os.ModePerm)
		if err != nil {
			return "", fmt.Errorf("failed to create directory: %w", err)
		}
	}

	// Create the file
	file, err := os.Create(filePath)
	if err != nil {
		return "", fmt.Errorf("failed to create CSV file: %w", err)
	}
	defer file.Close()

	writer := csv.NewWriter(file)
	writer.Comma = ';' // Use semicolon as delimiter as shown in the example
	defer writer.Flush()

	// Write header definitions
	writer.Write([]string{"0", "AS_VORGANG_KOPF", "BetrNr", "VorgangNr", "VorgangTyp", "AdrBetrNr", "AdressTyp", "AdressNr", "AdrProjNr", "FremdKstNr", "FirmenISOWaehrung", "ISOWaehrung", "Kurs", "WaehrungsFaktor", "ReferenzNr", "ReferenzTyp", "OrginalNr", "ErfUser", "ErfDatum", "AenderUser", "AenderDatum", "VorgangsDatum", "ErledigtJN", "LieferTermin", "BearbAP", "BearbAPKom1", "BearbAPKom2", "AnwKz", "SkontoJN", "SammelFaktKz", "KstNachOrginalNr", "KstNachReferenzNr", "KstNachReferenzTyp", "PreisErmRE", "Lieferangaben"})

	writer.Write([]string{"1", "AS_VORGANG_POS", "BetrNr", "VorgangNr", "VorgangTyp", "PosNrVorgang", "PosTyp", "BelegNr", "BelegDatum", "BelegArt", "ReferenzNr", "ReferenzTyp", "OrginalNr", "PosBezeichnung", "Menge", "MengenEinheit", "PosSkontoJN", "PreisEinheit", "EinzelPreis", "ZuAbschlag", "ZuAbschlProzJN", "SteuerSchl", "MwstProzent", "WarenWertJN", "LagerNr", "LagerOrtNr", "EinsatzArt", "OhneEP_JN", "HaendlerPreis_JN", "KstReferenzNr", "KstReferenzTyp", "KstOrginalNr", "BezugArchiviert", "BestandswertEP", "Uhrzeit"})

	// Write company information
	writer.Write([]string{"14", "BETRIEB", "Betrieb"})
	writer.Write([]string{"14", "6178"})

	// Write data separator
	writer.Write([]string{"*DATEN*"})

	// Get current date for the CSV
	currentDate := time.Now().Format("2006-01-02")
	currentTime := time.Now().Format("15:04")

	// Generate a lieferschein number based on ID (first 8 chars)
	lieferscheinNr := strings.Replace(lieferschein.ID.String()[:8], "-", "", -1) + "-01"

	// Write header record (type 0)
	headerRecord := []string{
		"0",                          // Record type
		"6178",                       // BetrNr
		lieferscheinNr,               // VorgangNr
		"LS",                         // VorgangTyp (Lieferschein)
		"*",                          // AdrBetrNr
		"AAS",                        // AdressTyp
		"*",                          // AdressNr
		"*",                          // AdrProjNr
		"",                           // FremdKstNr
		"EUR",                        // FirmenISOWaehrung
		"EUR",                        // ISOWaehrung
		"0",                          // Kurs
		"0",                          // WaehrungsFaktor
		"1",                          // ReferenzNr
		"3",                          // ReferenzTyp
		lieferschein.KostenstelleVon, // OrginalNr
		"SCANNER",                    // ErfUser
		currentDate,                  // ErfDatum
		"",                           // AenderUser
		"",                           // AenderDatum
		currentDate,                  // VorgangsDatum
		"N",                          // ErledigtJN
		"",                           // LieferTermin
		"-1",                         // BearbAP
		"-2",                         // BearbAPKom1
		"-2",                         // BearbAPKom2
		"GR",                         // AnwKz
		"J",                          // SkontoJN
		"M",                          // SammelFaktKz
		lieferschein.KostenstelleZu,  // KstNachOrginalNr
		"",                           // KstNachReferenzNr
		"3",                          // KstNachReferenzTyp
		"N",                          // PreisErmRE
		fmt.Sprintf("Abholer: %s", lieferschein.Abholer), // Lieferangaben
	}
	writer.Write(headerRecord)

	// Write item records (type 1)
	for i, artikel := range lieferschein.Artikel {
		positionRecord := []string{
			"1",                    // Record type
			"6178",                 // BetrNr
			lieferscheinNr,         // VorgangNr
			"LS",                   // VorgangTyp
			fmt.Sprintf("%d", i+1), // PosNrVorgang
			"0",                    // PosTyp
			"",                     // BelegNr
			"",                     // BelegDatum
			"",                     // BelegArt
			strings.Replace(lieferscheinNr, "-01", "", 1), // ReferenzNr
			"1",                                   // ReferenzTyp
			artikel.Betriebsnummer,                // OrginalNr (Article number)
			artikel.Kurzname,                      // PosBezeichnung
			fmt.Sprintf("%d.000", artikel.Anzahl), // Menge
			"ST",                                  // MengenEinheit
			"N",                                   // PosSkontoJN
			"1",                                   // PreisEinheit
			"",                                    // EinzelPreis
			"",                                    // ZuAbschlag
			"J",                                   // ZuAbschlProzJN
			"",                                    // SteuerSchl
			"0",                                   // MwstProzent
			"N",                                   // WarenWertJN
			"1",                                   // LagerNr
			"1",                                   // LagerOrtNr
			"0",                                   // EinsatzArt
			"N",                                   // OhneEP_JN
			"N",                                   // HaendlerPreis_JN
			"0",                                   // KstReferenzNr
			"3",                                   // KstReferenzTyp
			"",                                    // KstOrginalNr
			"H",                                   // BezugArchiviert
			"0",                                   // BestandswertEP
			currentTime,                           // Uhrzeit
		}
		writer.Write(positionRecord)
	}

	return filePath, nil
}
