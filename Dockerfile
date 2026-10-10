FROM python:3.12-slim

WORKDIR /app

# Install server dependencies
COPY server/requirements.txt ./server/
RUN pip install --no-cache-dir -r server/requirements.txt

# Copy server code and pre-built frontend distribution
COPY server/ ./server/
COPY web/dist/ ./web/dist/

WORKDIR /app/server

ENV DS_HOST=0.0.0.0
ENV PORT=8710

EXPOSE 8710

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8710}"]
