#!/bin/sh
(
    set -eu
    YEONIEUM_APP_PASSWORD=$(cat /run/secrets/postgres_app_password)
    test -n "$YEONIEUM_APP_PASSWORD"
    export YEONIEUM_APP_PASSWORD
    psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --no-psqlrc --set ON_ERROR_STOP=1 <<'SQL'
\getenv app_password YEONIEUM_APP_PASSWORD
CREATE ROLE yeonieum LOGIN PASSWORD :'app_password';
ALTER DATABASE yeonieum OWNER TO yeonieum;
REVOKE CONNECT ON DATABASE yeonieum FROM PUBLIC;
SQL
)
