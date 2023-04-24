# Makefile

# Variables
DOCKER_IMAGE_NAME=rungpt_actions:latest

# Main Deno app targets
.PHONY: build
build:
	deno compile --unstable --allow-net --allow-read --allow-write --allow-env -o rungpt rungpt.ts

.PHONY: run
run:
	deno run --unstable --allow-net --allow-read --allow-write --allow-env --allow-run rungpt.ts

.PHONY: dev
dev:
	deno run --unstable --allow-net --allow-read --allow-write --allow-env --allow-run --watch rungpt.ts

# Actions Docker image targets
.PHONY: docker-build
docker-build:
	docker build -t $(DOCKER_IMAGE_NAME) -f docker/Dockerfile .

.PHONY: docker-clean
docker-clean:
	docker image rm $(DOCKER_IMAGE_NAME)

# Testing
.PHONY: test
test:
	deno test --allow-read --allow-run --allow-write --allow-env --unstable
