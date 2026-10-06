.PHONY: install frontend preview build

install:
	cd frontend && npm install

frontend:
	cd frontend && npm run dev

preview:
	cd frontend && npm run build && npm run preview -- --host 127.0.0.1

build:
	cd frontend && npm run build
