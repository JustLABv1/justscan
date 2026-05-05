package ai

import "justscan-backend/config"

type EffectiveAISettings struct {
	Enabled               bool
	AllowAnonymous        bool
	DefaultProviderKey    string
	DefaultTimeoutSeconds int
	MaxContextResults     int
}

func EffectiveSettings(conf *config.RestfulConf) EffectiveAISettings {
	settings := EffectiveAISettings{}
	if conf != nil {
		settings.Enabled = conf.AI.Enabled
		settings.AllowAnonymous = conf.AI.AllowAnonymous
		settings.DefaultProviderKey = conf.AI.DefaultProviderKey
		settings.DefaultTimeoutSeconds = conf.AI.DefaultTimeoutSeconds
		settings.MaxContextResults = conf.AI.MaxContextResults
	}

	resolver := config.GetResolver()
	if resolver == nil {
		return settings
	}

	settings.Enabled = resolver.GetBool("ai.enabled", settings.Enabled)
	settings.AllowAnonymous = resolver.GetBool("ai.allow_anonymous", settings.AllowAnonymous)
	settings.DefaultProviderKey = resolver.GetString("ai.default_provider_key", settings.DefaultProviderKey)
	settings.DefaultTimeoutSeconds = resolver.GetInt("ai.default_timeout_seconds", settings.DefaultTimeoutSeconds)
	settings.MaxContextResults = resolver.GetInt("ai.max_context_results", settings.MaxContextResults)
	return settings
}
