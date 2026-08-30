FROM node:24-bookworm-slim

RUN apt-get update && apt-get install -y \
    python3 \
    python3-venv \
    python3-pip \
    curl \
    ca-certificates \
    bash \
    git \
    && rm -rf /var/lib/apt/lists/*

# Install IBM Bob Shell
RUN curl -fsSL https://bob.ibm.com/download/bobshell.sh | bash -s -- --pm npm

# Python environment
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

WORKDIR /app

# Install NotProdReady backend dependencies
COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir -r /app/backend/requirements.txt

# Copy backend and IBM Bob configuration
COPY backend /app/backend
COPY .bob /app/.bob

WORKDIR /app/backend

ENV PYTHONUNBUFFERED=1

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-10000}"]