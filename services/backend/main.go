package main

import (
	"context"
	"encoding/csv"
	"fmt"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"justwms/config"
	"justwms/database"
	"justwms/router"

	"github.com/alecthomas/kingpin/v2"
	log "github.com/sirupsen/logrus"
)

const version string = "1.0.0"

var (
	configFile  = kingpin.Flag("config", "Config file").Short('c').Default("/etc/exflow/config.yaml").String()
	frontendEnv = kingpin.Flag("frontendEnv", "Path to frontend environment").Default("/etc/exflow/.env").String()
)

func logging(logLevel string) {
	logLevel = strings.ToLower(logLevel)

	switch logLevel {
	case "info":
		log.SetLevel(log.InfoLevel)
	case "warn":
		log.SetLevel(log.WarnLevel)
	case "error":
		log.SetLevel(log.ErrorLevel)
	case "debug":
		log.SetLevel(log.DebugLevel)
	default:
		log.SetLevel(log.InfoLevel)
	}
}

func main() {
	kingpin.Version(version)
	kingpin.HelpFlag.Short('h')
	kingpin.Parse()

	log.Info("Starting JustWMS API. Version: ", version)

	// Check if config file exists
	if _, err := os.Stat(*configFile); os.IsNotExist(err) {
		log.Fatal("Config file not found.")
		return
	}

	log.Info("Loading Config File: ", *configFile)
	err := config.GetInstance().LoadConfig(*configFile)
	if err != nil {
		log.Fatal("Failed to load config file", err)
		return
	}

	cfg := config.Config
	log.Info("Config loaded successfully")

	logging(cfg.LogLevel)

	db := database.StartDatabase(cfg.Database.Driver, cfg.Database.Server, cfg.Database.Port, cfg.Database.User, cfg.Database.Password, cfg.Database.Name)
	if db == nil {
		log.Fatal("Failed to connect to the database")
	}

	readKostenstellenCSV()
	readGeraeteCSV()

	// Set up signal handling for graceful shutdown
	server := router.StartRouter(db, cfg.Port)

	// Wait for interrupt signal to gracefully shutdown the server
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Info("Shutting down server...")

	// The server has 30 seconds to finish the request it is currently handling
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := server.Shutdown(ctx); err != nil {
		log.Fatal("Server forced to shutdown:", err)
	}

	log.Info("Server exited")
}

func readKostenstellenCSV() {
	// Open the CSV file
	file, err := os.Open("/Users/Justin.Neubert/Downloads/CSV Dareien/Kostenstellen.csv")
	if err != nil {
		log.Fatal(err)
	}
	defer file.Close()

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
		log.Info("No records found in CSV")
		return
	}

	fmt.Printf("Total records: %d\n", len(records))

	// Find the KOSTENST header row to understand the structure for cost center records
	var kostenstHeader []string
	for _, record := range records {
		if len(record) > 1 && record[1] == "KOSTENST" && record[0] == "0" {
			kostenstHeader = record[2:] // Skip the ID and type columns
			break
		}
	}

	if len(kostenstHeader) == 0 {
		fmt.Println("No KOSTENST header found")
		return
	}

	// Find column indices for cost center data
	kstNrIndex := -1

	for i, col := range kostenstHeader {
		trimmedCol := strings.TrimSpace(col)
		if trimmedCol == "KstNr" {
			kstNrIndex = i
			fmt.Printf("Found KstNr at index %d\n", i)
			break
		}
	}

	if kstNrIndex == -1 {
		fmt.Println("KstNr column not found!")
		return
	}

	// Process KO records (which are the cost center records we need)
	koCount := 0
	uniqueKstNr := make(map[string]bool) // Use map to track unique KstNr values

	for _, record := range records {
		if len(record) > 1 && record[1] == "KO" {
			koCount++

			var kstNr string
			dataFields := record[2:] // Skip ID and type columns

			if kstNrIndex >= 0 && kstNrIndex < len(dataFields) {
				kstNr = strings.TrimSpace(dataFields[kstNrIndex])
			}

			if kstNr != "" {
				uniqueKstNr[kstNr] = true // Add to map (automatically handles uniqueness)
			}
		}
	}

	// Print unique KstNr values
	fmt.Printf("Unique KstNr values:\n")
	for kstNr := range uniqueKstNr {
		fmt.Printf("KstNr: %s\n", kstNr)
	}

	fmt.Printf("\nTotal KO records found: %d\n", koCount)
	fmt.Printf("Unique KstNr values: %d\n", len(uniqueKstNr))
}

func readGeraeteCSV() {
	// Open the CSV file
	file, err := os.Open("/Users/Justin.Neubert/Downloads/CSV Dareien/Geräte.csv")
	if err != nil {
		log.Fatal(err)
	}
	defer file.Close()

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
		log.Info("No records found in CSV")
		return
	}

	fmt.Printf("Total records: %d\n", len(records))

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

	// fmt.Printf("GERAETE header has %d columns:\n", len(geraeteHeader)) --- IGNORE ---
	// for i, col := range geraeteHeader { --- IGNORE ---
	// 	fmt.Printf("Column %d: '%s'\n", i, col) --- IGNORE ---
	// } --- IGNORE ---

	// Find column indices for device data
	gerNrIndex := -1
	anlagegutIndex := -1

	for i, col := range geraeteHeader {
		trimmedCol := strings.TrimSpace(col)
		if trimmedCol == "GerNr" {
			gerNrIndex = i
			fmt.Printf("Found GerNr at index %d\n", i)
		} else if trimmedCol == "Anlagegut" {
			anlagegutIndex = i
			fmt.Printf("Found Anlagegut at index %d\n", i)
		}
	}

	if gerNrIndex == -1 || anlagegutIndex == -1 {
		fmt.Println("GerNr or Anlagegut column not found!")
		return
	}

	// Process GE records (which are the device records we need)
	fmt.Printf("Using GerNr at column index: %d and Anlagegut at index: %d\n\n", gerNrIndex, anlagegutIndex)
	fmt.Println("GE records (Devices):")
	geCount := 0

	for _, record := range records {
		if len(record) > 1 && record[1] == "GER" {
			geCount++

			var gerNr, anlagegut string
			dataFields := record[2:] // Skip ID and type columns

			if gerNrIndex >= 0 && gerNrIndex < len(dataFields) {
				gerNr = strings.TrimSpace(dataFields[gerNrIndex])
			}
			if anlagegutIndex >= 0 && anlagegutIndex < len(dataFields) {
				anlagegut = strings.TrimSpace(dataFields[anlagegutIndex])
			}

			fmt.Printf("GerNr: %s, Anlagegut: %s\n", gerNr, anlagegut)
		}
	}

	fmt.Printf("\nTotal GE records found: %d\n", geCount)
}
