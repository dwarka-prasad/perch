.PHONY: run desktop dev deb docker docker-up install-user uninstall-user clean \
        test test-frontend

run:            ## run the server in the foreground
	PYTHONPATH=src python3 -m perch

test:           ## unit + HTTP smoke tests
	python3 -m unittest discover -s tests -v

test-frontend:  ## drive the real app in headless Chrome
	node tests/frontend/smoke.mjs

desktop:        ## run the native desktop window
	PYTHONPATH=src python3 -m perch.desktop

dev:            ## editable install into the current environment
	pip install -e ".[office]"

deb:            ## build dist/perch_<version>_all.deb
	bash packaging/build-deb.sh

docker:         ## build the container image
	docker build -f docker/Dockerfile -t perch:latest .

docker-up:      ## run via docker compose (host monitoring)
	docker compose -f docker/compose.yaml up -d --build

install-user:   ## install for the current user (no root): service + launcher
	bash scripts/install.sh

uninstall-user: ## remove the per-user install
	systemctl --user disable --now perch || true
	rm -f ~/.local/share/applications/perch.desktop
	rm -f ~/.local/share/icons/hicolor/scalable/apps/perch.svg
	rm -f ~/.config/systemd/user/perch.service

clean:
	rm -rf dist build src/*.egg-info **/__pycache__

help:
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
	 awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-14s\033[0m %s\n",$$1,$$2}'
