// Stub de `server-only` para el entorno de tests (node). El paquete real lanza fuera de un RSC;
// en los tests de integración del backend importamos módulos de servidor directamente, así que
// aquí es un no-op. NO cambia el comportamiento de producción (solo aplica bajo vitest, vía alias).
export {};
