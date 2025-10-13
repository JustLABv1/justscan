# CSV Bridge Service

A lightweight Go service that runs on customer servers to receive CSV files from your VPS application and store them locally within the customer's private network.

## Features

- **Automatic Registration**: Registers with your VPS application on startup
- **Health Monitoring**: Periodic heartbeat to maintain connection with VPS
- **Secure File Upload**: API key-based authentication for file transfers
- **Docker Support**: Easy deployment with Docker and Docker Compose
- **Configurable Storage**: Customizable file storage location
- **Health Checks**: Built-in health monitoring and status endpoints

## Quick Installation

### Prerequisites
- Docker and Docker Compose installed
- Network access to your VPS application
- Open port 8080 (or configure custom port)

### 1. Download and Setup
```bash
# Download the CSV bridge service files to customer server
# Extract to desired location (e.g., /opt/csv-bridge)

# Make install script executable
chmod +x install.sh

# Run installation
./install.sh
```

### 2. Configuration
During installation, you'll be prompted for:
- **VPS URL**: Your VPS application URL (e.g., https://your-vps.com)
- **VPS API Token**: Authentication token for your VPS
- **Bridge API Key**: Secure key for this bridge service

### 3. Verify Installation
```bash
# Check service status
docker-compose ps

# View service logs
docker-compose logs csv-bridge

# Test health endpoint
curl http://localhost:8080/health
```

## Manual Configuration

### Environment Variables
```bash
CSV_BRIDGE_HOST=0.0.0.0
CSV_BRIDGE_PORT=8080
CSV_BRIDGE_UPLOAD_DIR=/var/csv-files
CSV_BRIDGE_VPS_URL=https://your-vps-app.com
CSV_BRIDGE_API_TOKEN=your-vps-api-token
CSV_BRIDGE_API_KEY=bridge-service-api-key
```

### Config File (config.yaml)
```yaml
server:
  host: "0.0.0.0"
  port: 8080
  upload_dir: "/var/csv-files"
  max_file_size: 10485760  # 10MB

vps:
  base_url: "https://your-vps-app.com"
  api_token: "your-secret-api-token"
  register_interval: 300  # 5 minutes

bridge:
  service_id: "csv-bridge-001"
  service_name: "Customer CSV Bridge"
  version: "1.0.0"

security:
  api_key: "customer-bridge-secret-key"
  enable_cors: true
```

## API Endpoints

### Health Check
```
GET /health
```

Response:
```json
{
  "status": "healthy",
  "service": "Customer CSV Bridge",
  "version": "1.0.0",
  "service_id": "csv-bridge-001",
  "timestamp": "2025-10-13T12:00:00Z",
  "upload_dir": "/var/csv-files",
  "upload_dir_ok": true
}
```

### Service Information
```
GET /info
```

Response:
```json
{
  "service_id": "csv-bridge-001",
  "service_name": "Customer CSV Bridge",
  "version": "1.0.0",
  "upload_url": "http://customer-server:8080/upload",
  "health_url": "http://customer-server:8080/health",
  "max_file_size": 10485760,
  "timestamp": "2025-10-13T12:00:00Z"
}
```

### File Upload
```
POST /upload
Headers: X-API-Key: your-bridge-api-key
Content-Type: multipart/form-data
```

Form data:
- `file`: The CSV file to upload

Response:
```json
{
  "status": "success",
  "message": "File uploaded successfully",
  "filename": "abc12345_20251013_120000.csv",
  "file_id": "uuid-here",
  "size": 2048,
  "timestamp": "2025-10-13T12:00:00Z"
}
```

## Management Commands

```bash
# Start service
docker-compose up -d

# Stop service
docker-compose down

# View logs
docker-compose logs -f csv-bridge

# Restart service
docker-compose restart csv-bridge

# Update service
docker-compose pull
docker-compose up -d --build

# Check service status
docker-compose ps
```

## File Storage

Files are stored in the configured upload directory with the following naming convention:
```
{file_id}_{timestamp}.{extension}
```

Example: `abc12345_20251013_120000.csv`

Default storage location: `/var/csv-files` (mapped to `./data` on host)

## Security Considerations

1. **API Key**: Use a strong, unique API key for each bridge service
2. **Network**: Consider firewall rules to limit access to port 8080
3. **File Permissions**: Ensure proper file system permissions for upload directory
4. **TLS**: For production, consider running behind a reverse proxy with TLS

## Troubleshooting

### Service Won't Start
```bash
# Check logs
docker-compose logs csv-bridge

# Verify configuration
cat config.yaml

# Check port availability
netstat -tulpn | grep 8080
```

### Registration Issues
```bash
# Check VPS connectivity
curl -I https://your-vps-app.com

# Verify API token
curl -H "Authorization: Bearer your-token" https://your-vps-app.com/api/v1/health
```

### File Upload Issues
```bash
# Check upload directory permissions
ls -la ./data

# Test upload endpoint
curl -X POST -H "X-API-Key: your-key" -F "file=@test.csv" http://localhost:8080/upload
```

## Integration with VPS Application

Your VPS application will automatically:
1. Receive registration from this bridge service
2. Store bridge information in the database
3. Use this bridge for CSV file transfers
4. Monitor bridge health via heartbeat

The mobile interface will show available bridge services for file transfer selection.

## Support

For issues or questions, check:
1. Service logs: `docker-compose logs csv-bridge`
2. VPS application bridge management page
3. Network connectivity between services
4. Configuration file syntax and values