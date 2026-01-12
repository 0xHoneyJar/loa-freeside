import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';

const faqs = [
  {
    question: "What's conviction scoring?",
    answer:
      "Our algorithm analyzes holding duration, trading patterns, and on-chain activity to score how committed each holder is. Diamond hands get recognized.",
  },
  {
    question: 'How long does setup take?',
    answer:
      "About 15 minutes. If you already have Collab.Land installed, it's even faster — Arrakis builds on your existing setup.",
  },
  {
    question: 'Can I try before I buy?',
    answer:
      'Yes! The Starter plan is free forever. Shadow mode lets you test tier assignments before going live with your community.',
  },
  {
    question: 'What happens if I downgrade?',
    answer:
      "Your tier configurations are preserved. You'll keep the first 3 tiers and 1 server. Historical data is retained for 30 days.",
  },
];

export function FAQAccordion() {
  return (
    <Accordion type="single" collapsible className="border-t border-sand-dim/20">
      {faqs.map((faq, index) => (
        <AccordionItem key={index} value={`item-${index}`}>
          <AccordionTrigger>{faq.question}</AccordionTrigger>
          <AccordionContent>{faq.answer}</AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}
