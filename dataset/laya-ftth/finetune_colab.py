# Fine-tuning Laya para FTTH - Copiar TODO este código en una celda de Colab

!pip install peft transformers accelerate torch sentencepiece protobuf -q

import urllib.request, os
os.makedirs('/content/dataset', exist_ok=True)
for name, url in {
    'train.jsonl': 'https://raw.githubusercontent.com/tecnodespegue/FTTH-Copilot/feat/fiber-plan-viewer/dataset/laya-ftth/v3/train/train/laya-format.jsonl',
    'val.jsonl': 'https://raw.githubusercontent.com/tecnodespegue/FTTH-Copilot/feat/fiber-plan-viewer/dataset/laya-ftth/v3/train/val/laya-format.jsonl',
    'test.jsonl': 'https://raw.githubusercontent.com/tecnodespegue/FTTH-Copilot/feat/fiber-plan-viewer/dataset/laya-ftth/v3/train/test/laya-format.jsonl',
}.items():
    print(f'Downloading {name}...')
    urllib.request.urlretrieve(url, f'/content/dataset/{name}')

import json, torch
from peft import LoraConfig, get_peft_model, TaskType
from torch.utils.data import Dataset
from transformers import AutoModelForSequenceClassification, AutoTokenizer, Trainer, TrainingArguments, DataCollatorWithPadding

LAYA_MODEL = 'microsoft/deberta-v3-base'
FTTH_CLASSES = ['NORMAL', 'OPTICAL_DEGRADATION', 'OPTICAL_FAULT', 'POWER_FAULT', 'DEVICE_FAULT', 'UPLINK_FAULT', 'CONGESTION', 'MASS_OUTAGE', 'UNKNOWN']
CLASS_TO_ID = {c: i for i, c in enumerate(FTTH_CLASSES)}
ID_TO_CLASS = {i: c for c, i in CLASS_TO_ID.items()}
print(f'GPU: {torch.cuda.get_device_name(0)}')

class FTTHDataset(Dataset):
    def __init__(self, path, tokenizer):
        self.tokenizer = tokenizer
        self.data = []
        with open(path) as f:
            for line in f:
                r = json.loads(line)
                ec = r['answers'].get('event_class', {}).get('choice', 'UNKNOWN')
                if ec in CLASS_TO_ID:
                    self.data.append({'text': r['input'], 'label': CLASS_TO_ID[ec]})
    def __len__(self): return len(self.data)
    def __getitem__(self, i):
        ex = self.data[i]
        enc = self.tokenizer(ex['text'], max_length=128, padding='max_length', truncation=True, return_tensors='pt')
        return {'input_ids': enc['input_ids'].squeeze(), 'attention_mask': enc['attention_mask'].squeeze(), 'labels': torch.tensor(ex['label'])}

tokenizer = AutoTokenizer.from_pretrained(LAYA_MODEL)
if tokenizer.pad_token is None: tokenizer.pad_token = tokenizer.eos_token
model = AutoModelForSequenceClassification.from_pretrained(LAYA_MODEL, num_labels=9, ignore_mismatched_sizes=True)
lora_config = LoraConfig(r=16, lora_alpha=32, lora_dropout=0.1, target_modules=['query_proj', 'key_proj', 'value_proj'], task_type=TaskType.SEQ_CLS)
model = get_peft_model(model, lora_config)
print(f'LoRA params: {sum(p.numel() for p in model.parameters() if p.requires_grad):,}')

train_ds = FTTHDataset('/content/dataset/train.jsonl', tokenizer)
val_ds = FTTHDataset('/content/dataset/val.jsonl', tokenizer)
print(f'Train: {len(train_ds)} | Val: {len(val_ds)}')

args = TrainingArguments(output_dir='/content/ftth-laya-v1', num_train_epochs=5, per_device_train_batch_size=8, per_device_eval_batch_size=8, learning_rate=1e-4, warmup_ratio=0.1, weight_decay=0.01, logging_steps=10, eval_strategy='epoch', save_strategy='epoch', load_best_model_at_end=True, fp16=True, report_to='none', seed=42)
trainer = Trainer(model=model, args=args, train_dataset=train_ds, eval_dataset=val_ds, data_collator=DataCollatorWithPadding(tokenizer=tokenizer))
trainer.train()

trainer.save_model('/content/ftth-laya-v1')
tokenizer.save_pretrained('/content/ftth-laya-v1')
with open('/content/ftth-laya-v1/config.json', 'w') as f:
    json.dump({'model_name': LAYA_MODEL, 'classes': FTTH_CLASSES, 'class_to_id': CLASS_TO_ID}, f)
print('Model saved to /content/ftth-laya-v1')

test_ds = FTTHDataset('/content/dataset/test.jsonl', tokenizer)
model.eval()
correct, total, class_stats = 0, 0, {}
for ex in test_ds.data:
    inputs = tokenizer(ex['text'], return_tensors='pt', truncation=True, max_length=128)
    inputs = {k: v.cuda() for k, v in inputs.items()}
    with torch.no_grad(): pred = model(**inputs).logits.argmax().item()
    true = ex['label']
    if pred == true: correct += 1
    total += 1
    cls = ID_TO_CLASS[true]
    if cls not in class_stats: class_stats[cls] = {'correct': 0, 'total': 0}
    class_stats[cls]['total'] += 1
    if pred == true: class_stats[cls]['correct'] += 1

print(f'\nTest Accuracy: {correct}/{total} = {correct/total*100:.1f}%')
for cls in sorted(class_stats.keys()):
    s = class_stats[cls]
    pct = s['correct']/s['total']*100 if s['total'] > 0 else 0
    print(f'  {cls}: {s["correct"]}/{s["total"]} = {pct:.1f}%')
