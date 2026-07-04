"use client";
import { useRol } from "./RolProvider";

/**
 * Renderiza children SOLO si el rol del gestor logueado está permitido.
 * Uso: <RequireRol roles={["admin"]}>...</RequireRol>
 *      <RequireRol rol="admin">...</RequireRol>   (azúcar de roles={[rol]})
 * `admin` SIEMPRE pasa (superset) salvo que se excluya explícitamente.
 * Mientras carga el rol, no renderiza nada (evita parpadeo del botón).
 * `fallback` opcional para mostrar algo en lugar de ocultar.
 */
export default function RequireRol({ rol, roles, children, fallback = null }) {
  const { rol: rolActual, cargando } = useRol();
  if (cargando) return null;
  const permitidos = roles ?? (rol ? [rol] : []);
  return permitidos.includes(rolActual) ? children : fallback;
}
