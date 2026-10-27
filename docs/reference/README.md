# Reference

Documentación de **consulta**: describe *qué* existe, sin explicar ni enseñar. Cada
página es una tabla o un catálogo que se consulta mientras se trabaja.

| Documento | Qué contiene |
|---|---|
| [Configuración](configuracion.md) | Todas las variables de entorno, con default, obligatoriedad y dónde se leen |
| [API HTTP](api-http.md) | Todos los endpoints de `apps/web/app/api/**`, con método, guard y forma de respuesta — **generada** desde el contrato [`docs/contract/openapi.yaml`](../contract/openapi.yaml) |
| [Línea de comandos](linea-de-comandos.md) | Scripts de `package.json` y de `scripts/`, con flags y precondiciones |
| [Modelo de datos](modelo-de-datos.md) | Modelos Prisma, enums, relaciones y aislamiento por tenant |
| [Paquetes internos](paquetes.md) | Los 12 paquetes del workspace y sus fronteras de responsabilidad |
| [Contenedores y CI](contenedores-y-ci.md) | Servicios de Docker Compose, imágenes, workflows de GitHub Actions |

## La API HTTP es generado

`api-http.md` no se edita a mano: sale del contrato
[`docs/contract/openapi.yaml`](../contract/openapi.yaml), que es la fuente única de verdad
de la API. Para cambiar un endpoint se edita el contrato y se regenera:

```bash
pnpm contract:generate   # regenera la referencia, los tipos y los validadores
pnpm contract:check      # falla si el contrato y el código no coinciden
```


## Cómo usar esta sección

Si querés **hacer** algo, andá a [How-to](../how-to/). Si querés **entender** por qué
el sistema está armado así, andá a [Explanation](../explanation/). Si estás
**aprendiendo** el producto de cero, empezá por [Tutorials](../tutorials/).

Las referencias citan `path:line` del código: si algo cambia en el código, la referencia
queda desactualizada y eso se ve comparando contra la fuente.
