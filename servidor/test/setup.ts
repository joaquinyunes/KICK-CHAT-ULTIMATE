// Variables mínimas para que src/config/env.ts valide en el entorno de test.
process.env.NODE_ENV = "test";
process.env.MASTER_KEY ||= "0".repeat(64); // 32 bytes hex
process.env.JWT_SECRET ||= "test_jwt_secret_con_mas_de_16_chars";
process.env.KICK_CLIENT_ID ||= "test-client-id";
process.env.KICK_CLIENT_SECRET ||= "test-client-secret";
process.env.KICK_REDIRECT_URI ||= "http://localhost:3000/auth/kick/callback";
process.env.OPENROUTER_API_KEY ||= "";
