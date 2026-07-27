package app

import (
	"bytes"
	"errors"
	"reflect"
	"strings"
	"testing"
)

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

func TestScanLocalCommandAcceptsEngineFlag(t *testing.T) {
	root := newRoot("test", "", "")
	output := &bytes.Buffer{}
	root.SetOut(output)
	root.SetErr(output)
	root.SetArgs([]string{"scan", "local", "my-app:local", "--engine", "podman", "--help"})

	if err := root.Execute(); err != nil {
		t.Fatalf("scan local help: %v", err)
	}
	if !bytes.Contains(output.Bytes(), []byte("--engine")) {
		t.Fatalf("scan local help did not include local-image flags: %s", output.String())
	}
}

func TestScanSupportsLocalAndArchiveModes(t *testing.T) {
	root := newRoot("test", "", "")
	output := &bytes.Buffer{}
	root.SetOut(output)
	root.SetErr(output)
	root.SetArgs([]string{"scan", "--local", "my-app:local", "--engine", "podman", "--help"})
	if err := root.Execute(); err != nil {
		t.Fatalf("scan --local help: %v", err)
	}
	if !bytes.Contains(output.Bytes(), []byte("--archive")) || !bytes.Contains(output.Bytes(), []byte("--local")) {
		t.Fatalf("scan help did not expose source modes: %s", output.String())
	}

	root = newRoot("test", "", "")
	root.SetArgs([]string{"scan", "--local", "--archive", "image.tar"})
	if err := root.Execute(); err == nil || !strings.Contains(err.Error(), "cannot be used together") {
		t.Fatalf("mutually exclusive mode error = %v", err)
	}
}

func TestLocalImageExportKeepsUploadErrorAfterStoppingExporter(t *testing.T) {
	uploadErr := errors.New("JustScan API returned 413: uploaded archive exceeds the 5 GB limit")
	err := localImageExportError("podman", uploadErr, errors.New("signal: killed"), "", true)
	if !errors.Is(err, uploadErr) {
		t.Fatalf("error = %v, want original upload error", err)
	}
	if strings.Contains(err.Error(), "signal: killed") {
		t.Fatalf("error exposed expected exporter termination: %v", err)
	}
}

func TestAppleContainerImageSaveArguments(t *testing.T) {
	if !isAppleContainerEngine("/usr/local/bin/container") {
		t.Fatal("expected the Apple Container executable path to be recognized")
	}
	if isAppleContainerEngine("docker") {
		t.Fatal("docker must not be recognized as the Apple Container executable")
	}

	got := localImageSaveArguments("container", "example/app:latest", "linux/arm64", "/tmp/image.tar")
	want := []string{"image", "save", "--output", "/tmp/image.tar", "--platform", "linux/arm64", "example/app:latest"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("Apple Container save arguments = %#v, want %#v", got, want)
	}
}

func TestDockerAndPodmanImageSaveArgumentsRemainStreamingCompatible(t *testing.T) {
	want := []string{"image", "save", "example/app:latest"}
	for _, engine := range []string{"docker", "podman"} {
		if got := localImageSaveArguments(engine, "example/app:latest", "linux/arm64", ""); !reflect.DeepEqual(got, want) {
			t.Fatalf("%s save arguments = %#v, want %#v", engine, got, want)
		}
	}
}
