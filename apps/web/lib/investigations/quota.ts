/**
 * Lo que la web usa de la cuota de investigaciones.
 *
 * La cuota se consume en el proceso que recibe el pedido, así que esto sí
 * vive en la web. El `export *` traía además el pipeline y el cierre, que
 * son del worker: ahora el shim expone sólo la cuota.
 */

export { consumeInvestigationQuota } from '@ftth-copilot/investigations';
