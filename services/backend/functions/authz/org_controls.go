package authz

import (
	"net/http"

	"justscan-backend/pkg/models"

	"github.com/gin-gonic/gin"
)

func IsReadOnlyRequest(method string) bool {
	switch method {
	case http.MethodGet, http.MethodHead, http.MethodOptions:
		return true
	default:
		return false
	}
}

func EnsureOrgActionAllowed(c *gin.Context, org *models.Org, action string) bool {
	if org == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "organization not found"})
		return false
	}

	if !org.IsActive {
		c.JSON(http.StatusForbidden, gin.H{"error": "organization is suspended"})
		return false
	}

	switch action {
	case "image_scan":
		if !org.AllowImageScans {
			c.JSON(http.StatusForbidden, gin.H{"error": "image scanning is disabled for this organization"})
			return false
		}
	case "helm_scan":
		if !org.AllowHelmScans {
			c.JSON(http.StatusForbidden, gin.H{"error": "Helm scanning is disabled for this organization"})
			return false
		}
	case "rescan":
		if !org.AllowRescans {
			c.JSON(http.StatusForbidden, gin.H{"error": "rescans are disabled for this organization"})
			return false
		}
	case "member_invite":
		if !org.AllowMemberInvites {
			c.JSON(http.StatusForbidden, gin.H{"error": "member invites are disabled for this organization"})
			return false
		}
	case "org_token":
		if !org.AllowOrgTokens {
			c.JSON(http.StatusForbidden, gin.H{"error": "organization tokens are disabled for this organization"})
			return false
		}
	}

	return true
}
