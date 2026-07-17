package middleware

import (
	"context"

	api "github.com/easyssh/server/internal/api/openapi"
	"github.com/getkin/kin-openapi/openapi3filter"
	"github.com/gin-gonic/gin"
	ginmiddleware "github.com/oapi-codegen/gin-middleware"
)

// OpenAPIRequestValidation validates request parameters and bodies against the
// generated contract. Authentication remains the responsibility of the OAuth
// middleware that follows it in each route group.
func OpenAPIRequestValidation() gin.HandlerFunc {
	spec, err := api.GetSwagger()
	if err != nil {
		panic("load embedded OpenAPI contract: " + err.Error())
	}

	return ginmiddleware.OapiRequestValidatorWithOptions(spec, &ginmiddleware.Options{
		SilenceServersWarning: true,
		Options: openapi3filter.Options{
			AuthenticationFunc: func(context.Context, *openapi3filter.AuthenticationInput) error {
				return nil
			},
		},
		ErrorHandler: func(c *gin.Context, message string, statusCode int) {
			c.AbortWithStatusJSON(statusCode, gin.H{
				"error":   "openapi_validation_failed",
				"message": message,
			})
		},
	})
}
