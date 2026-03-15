from pathlib import Path

PROJECT_DIR = Path(__file__).parent
EXPORTS_DIR = PROJECT_DIR / "exports"
EXPORTS_DIR.mkdir(exist_ok=True)
