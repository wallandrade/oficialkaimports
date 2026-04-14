import crypto from 'crypto';
import mysql from 'mysql2/promise';

async function createAdmin() {
    const connection = await mysql.createConnection("mysql://root:@localhost:3306/oficialkaimports");

    const username = "novo_admin"; // Altere para o nome desejado
    const password = "senha_segura"; // Altere para a senha desejada
    const salt = crypto.randomBytes(16).toString("hex");
    const passwordHash = crypto.createHash("sha256").update(password + salt).digest("hex");
    const id = crypto.randomBytes(8).toString("hex");

    await connection.query(
        "INSERT IGNORE INTO admin_users (id, username, password_hash, salt, is_primary) VALUES (?, ?, ?, ?, ?)",
        [id, username, passwordHash, salt, false]
    );

    console.log("Novo admin criado com sucesso.");
    process.exit(0);
}
createAdmin().catch(console.error);
