.PHONY: dev backend frontend install build test

# Run both frontend dev server and backend together with labeled output
dev: install
	@echo "Starting backend (port 8000) and frontend (port 5173)..."
	@echo "Open http://localhost:5173 for development"
	@echo ""
	@trap 'kill 0' EXIT; \
		. venv/bin/activate && uvicorn main:app --reload --port 8000 2>&1 | sed -u 's/^/[BACKEND]  /' & \
		sleep 1; \
		cd frontend && npm run dev 2>&1 | sed -u 's/^/[FRONTEND] /' & \
		wait

# Run backend only
backend:
	uvicorn main:app --reload --port 8000

# Run frontend dev server only
frontend:
	cd frontend && npm run dev

# Install all dependencies
install:
	@if [ ! -d "frontend/node_modules" ]; then \
		echo "Installing frontend dependencies..."; \
		cd frontend && npm install; \
	fi

# Build frontend for production (served by FastAPI directly)
build:
	cd frontend && npm run build

# Run tests
test:
	pytest tests/ -v
