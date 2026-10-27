import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MetaService } from '../../services/meta.service';

@Component({
  selector: 'app-editorial-policy',
  standalone: true,
  imports: [RouterLink],
  template: `
    <main class="mx-auto max-w-3xl space-y-8 px-4 py-12 text-[var(--portal-text)]">
      <a routerLink="/" class="underline">Volver al inicio</a>
      <h1 class="text-3xl font-bold">Política editorial</h1>
      <p>Guía TV ofrece información para elegir qué ver en televisión, cine y streaming.
        Estos criterios se aplican a la aprobación de nuevos contenidos y a la revisión del archivo editorial.</p>
      <p>Guía TV es un proyecto de <a class="underline" href="https://tecnoriasl.com/">TecnoRia</a>.
        El editor responsable es Max Nova. Beatriz Olmedo y Arturo Baroja también colaboran en la
        creación y revisión de textos.</p>
      <section class="space-y-3">
        <h2 class="text-xl font-semibold">Contenido elaborado con inteligencia artificial</h2>
        <p>Parte de nuestras guías la investigan, redactan y revisan agentes de inteligencia artificial de Guía TV.
          Esos artículos se firman como «Redacción IA de Guía TV» y terminan con una nota que lo indica y da la fecha
          en que se comprobaron sus fuentes. Un sistema de IA no ve programas ni prueba servicios, así que estos textos
          no describen experiencias propias.</p>
      </section>
      <section class="space-y-3">
        <h2 class="text-xl font-semibold">Cómo se comprueban los datos</h2>
        <p>Cada precio, fecha, horario, canal o dato de disponibilidad de un artículo de IA debe apoyarse en una cita
          literal de una fuente que el sistema ha descargado. Un programa, no un modelo de IA, comprueba que la cita
          aparece en esa fuente. Los datos que no se pueden comprobar, o que se contradicen entre fuentes, se descartan
          y no llegan al texto.</p>
        <p>Después, un agente de IA distinto del que escribió contrasta el borrador con esas pruebas. También se
          comprueban de forma automática los enlaces, los metadatos y que el artículo no repita otro ya publicado.
          Un artículo que falla una comprobación no se publica; los casos dudosos, como un posible duplicado, los
          decide una persona.</p>
      </section>
      <section class="space-y-3">
        <h2 class="text-xl font-semibold">Supervisión humana y publicación automática</h2>
        <p>Preparar un borrador es automático; publicarlo es una decisión aparte, que se toma de una de estas dos formas:</p>
        <ul class="list-disc pl-6 space-y-1">
          <li>Una persona identificada aprueba el artículo, y la aprobación registra quién la dio y cuándo.</li>
          <li>La publicación automática: un artículo de IA que supera todas las comprobaciones anteriores se publica sin
            una revisión humana individual. Si una comprobación falla, el sistema corrige el borrador y lo vuelve a
            comprobar entero un número limitado de veces; si no lo consigue, el artículo no se publica.</li>
        </ul>
        <p>Las personas responsables de Guía TV deciden si la publicación automática está activa, fijan cuántos artículos
          puede publicar al día y pueden detenerla en cualquier momento. Cada artículo registra si lo aprobó una persona
          o la política automática.</p>
      </section>
      <section class="space-y-3">
        <h2 class="text-xl font-semibold">Fuentes y actualidad</h2>
        <p>Preferimos las fuentes primarias, como las webs de operadores, plataformas y competiciones, y los datos de la
          propia guía de programación de Guía TV. Los artículos enlazan las fuentes que utilizan e indican cuándo se
          comprobaron.</p>
        <p>Los precios, la disponibilidad y los horarios cambian. Cada dato tiene una fecha para volver a comprobarlo,
          según lo rápido que cambie: un horario de emisión, al día siguiente; un precio o la disponibilidad en una
          plataforma, al cabo de un mes. Un artículo de IA con datos caducados no puede publicarse.</p>
      </section>
      <section class="space-y-3">
        <h2 class="text-xl font-semibold">Imágenes</h2>
        <p>Las imágenes de terceros deben contar con permiso de uso y la atribución que corresponda. Las imágenes
          generadas con IA son ilustraciones originales, y su texto alternativo indica que lo son. Nunca imitan
          carteles, fotogramas, logotipos ni a personas reales, ni se presentan como imágenes auténticas de una
          película o un programa.</p>
      </section>
      <section class="space-y-3">
        <h2 class="text-xl font-semibold">Publicidad y recomendaciones</h2>
        <p>Los patrocinios y enlaces de afiliación deben identificarse de forma visible. Una relación comercial
          no exime de verificar las afirmaciones ni de explicar las limitaciones de una recomendación.</p>
      </section>
      <section class="space-y-3">
        <h2 class="text-xl font-semibold">Correcciones y revisión del archivo</h2>
        <p>Corregimos o retiramos un artículo cuando sus fuentes cambian o alguien nos señala un error. Cualquier
          cambio en el texto lo devuelve a borrador hasta que vuelve a aprobarse, y guardamos las versiones anteriores
          para poder restaurarlas.</p>
        <p>El archivo está en revisión para corregir artículos breves, fuentes insuficientes y contenidos repetidos.
          Esta política no certifica que todos los artículos anteriores hayan completado esa revisión.</p>
        <p>Para comunicar un error, envía la URL y la información que permita comprobarlo a
          <a class="underline" href="mailto:soporte@tecnoriasl.com">soporte&#64;tecnoriasl.com</a>.</p>
      </section>
    </main>
  `,
})
export class EditorialPolicyComponent {
  constructor() {
    inject(MetaService).setMetaTags({
      title: 'Política editorial | Guía TV',
      description: 'Cómo se elaboran, comprueban y corrigen los contenidos de Guía TV, incluido el uso de inteligencia artificial, la supervisión humana y las fuentes.',
      canonicalUrl: '/politica-editorial',
    });
  }
}
