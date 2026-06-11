-- Run this as MariaDB root ONCE on the production server.
-- Replace 'StrongPasswordHere' with a real password (20+ random chars).
--
-- On Debian/Ubuntu, MariaDB root uses unix_socket auth by default, so use:
--   sudo mariadb < db/create-mariadb-user.sql
-- or:
--   sudo mysql < db/create-mariadb-user.sql

CREATE USER IF NOT EXISTS 'cima_app'@'localhost' IDENTIFIED BY 'StrongPasswordHere';

-- Grant only the privileges the application actually needs
GRANT SELECT, INSERT, UPDATE, DELETE ON cima.* TO 'cima_app'@'localhost';

-- Allow the setup script to run (only needed once; revoke afterwards if desired)
GRANT CREATE, DROP, INDEX, ALTER, REFERENCES ON cima.* TO 'cima_app'@'localhost';

FLUSH PRIVILEGES;

-- After running db/setup.js you can optionally revoke schema-change rights:
--   REVOKE CREATE, DROP, INDEX, ALTER, REFERENCES ON cima.* FROM 'cima_app'@'localhost';
--   FLUSH PRIVILEGES;
