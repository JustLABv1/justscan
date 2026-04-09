package models

import (
	"database/sql/driver"
	"encoding/json"
	"fmt"
)

// JSONObject stores arbitrary structured provider payloads in JSONB columns.
type JSONObject map[string]any

func (o JSONObject) Value() (driver.Value, error) {
	if o == nil {
		return "{}", nil
	}
	b, err := json.Marshal(o)
	return string(b), err
}

func (o *JSONObject) Scan(v interface{}) error {
	var b []byte
	switch t := v.(type) {
	case []byte:
		b = t
	case string:
		b = []byte(t)
	default:
		return fmt.Errorf("unexpected type %T", v)
	}
	if len(b) == 0 {
		*o = JSONObject{}
		return nil
	}
	return json.Unmarshal(b, o)
}
