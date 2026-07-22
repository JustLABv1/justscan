package app

import "testing"

func TestLocalImageMetadata(t *testing.T) {
	tests := []struct {
		image string
		name  string
		tag   string
	}{
		{image: "my-app:local", name: "my-app", tag: "local"},
		{image: "registry.example.com/team/my-app:1.2.3", name: "registry.example.com/team/my-app", tag: "1.2.3"},
		{image: "registry.example.com:5000/team/my-app", name: "registry.example.com:5000/team/my-app", tag: "local"},
	}

	for _, test := range tests {
		t.Run(test.image, func(t *testing.T) {
			if got := localImageName(test.image); got != test.name {
				t.Fatalf("localImageName(%q) = %q, want %q", test.image, got, test.name)
			}
			if got := localImageTag(test.image); got != test.tag {
				t.Fatalf("localImageTag(%q) = %q, want %q", test.image, got, test.tag)
			}
		})
	}
}
