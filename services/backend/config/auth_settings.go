package config

const (
	authSignInEnabledKey = "auth.sign_in_enabled"
	authSignUpEnabledKey = "auth.sign_up_enabled"
	authSSOOnlyKey       = "auth.sso_only"
	authLocalEnabledKey  = "auth.local_enabled"
)

// SignInEnabled reports whether any user sign-in method may create a session.
func SignInEnabled() bool {
	return runtimeAuthSetting(authSignInEnabledKey, true)
}

// SignUpEnabled reports whether visitors can create local accounts themselves.
func SignUpEnabled() bool {
	return runtimeAuthSetting(authSignUpEnabledKey, true)
}

// SSOOnly reports whether the sign-in page must expose SSO providers only.
func SSOOnly() bool {
	return runtimeAuthSetting(authSSOOnlyKey, false)
}

// LocalAuthEnabled includes the configured local-auth default and all runtime
// policy controls that can prevent password authentication.
func LocalAuthEnabled() bool {
	fallback := true
	if Config != nil {
		fallback = Config.LocalAuth.Enabled
	}
	return SignInEnabled() && !SSOOnly() && runtimeAuthSetting(authLocalEnabledKey, fallback)
}

func runtimeAuthSetting(key string, fallback bool) bool {
	resolver := GetResolver()
	if resolver == nil {
		return fallback
	}
	return resolver.GetBool(key, fallback)
}
