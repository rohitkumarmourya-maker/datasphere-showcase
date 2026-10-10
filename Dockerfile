FROM python:3.12-slim

# Create a non-root user with UID 1000 (standard for Hugging Face Spaces & security best practices)
RUN useradd -m -u 1000 user
WORKDIR /app

# Install dependencies
COPY server/requirements.txt ./server/
RUN pip install --no-cache-dir -r server/requirements.txt

# Copy server application and pre-built frontend distribution
COPY server/ ./server/
COPY web/dist/ ./web/dist/

# Set ownership for non-root user
RUN chown -R user:user /app
USER user

WORKDIR /app/server

ENV DS_HOST=0.0.0.0
ENV PORT=7860

EXPOSE 7860

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-7860}"]
