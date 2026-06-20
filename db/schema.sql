CREATE DATABASE IF NOT EXISTS cima
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE cima;

CREATE TABLE IF NOT EXISTS admin_users (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    username      VARCHAR(64)  NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS masterclasses (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    name         VARCHAR(255) NOT NULL,
    event_date   DATE         NOT NULL,
    num_datasets INT          NOT NULL,
    archived     TINYINT(1)   NOT NULL DEFAULT 0,
    created_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS event_data (
    id             INT AUTO_INCREMENT PRIMARY KEY,
    masterclass_id INT         NOT NULL,
    dataset_num    INT         NOT NULL,
    event_num      INT         NOT NULL,
    final_state    VARCHAR(20) DEFAULT NULL,
    primary_state  VARCHAR(20) DEFAULT NULL,
    mass_gev       DECIMAL(12,4) DEFAULT NULL,
    UNIQUE KEY uq_event (masterclass_id, dataset_num, event_num),
    FOREIGN KEY (masterclass_id) REFERENCES masterclasses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
