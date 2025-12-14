import { useState } from 'react';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Textarea } from './ui/Textarea';
import { Select } from './ui/Select';
import { Modal } from './ui/Modal';
import { Tabs, Tab } from './ui/Tabs';
import { CircularProgress } from './ui/CircularProgress';
import { Accordion, AccordionItem } from './ui/Accordion';
import { ToastContainer, ToastType } from './ui/Toast';
import { Search, Mail, Lock, Plus, Download, Settings, FileText, BarChart3, Target, Trophy } from 'lucide-react';

interface ComponentShowcaseProps {
  darkMode: boolean;
}

export function ComponentShowcase({ darkMode }: ComponentShowcaseProps) {
  const [showModal, setShowModal] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [textareaValue, setTextareaValue] = useState('');
  const [selectValue, setSelectValue] = useState('option1');
  const [activeTab, setActiveTab] = useState('overview');
  const [toasts, setToasts] = useState<Array<{ id: string; type: ToastType; title: string; message?: string }>>([]);

  const tabs: Tab[] = [
    { id: 'overview', label: 'Overview', icon: <BarChart3 className="w-4 h-4" /> },
    { id: 'documents', label: 'Documents', icon: <FileText className="w-4 h-4" />, badge: 3 },
    { id: 'analysis', label: 'Analysis', icon: <Target className="w-4 h-4" /> },
    { id: 'achievements', label: 'Achievements', icon: <Trophy className="w-4 h-4" />, badge: 5 }
  ];

  const accordionItems: AccordionItem[] = [
    {
      id: '1',
      title: 'Market Analysis',
      icon: <Target className="w-4 h-4" />,
      badge: 'Complete',
      content: (
        <div className="space-y-2">
          <p>Total Addressable Market: $2.5B</p>
          <p>Target Market Share: 5% in Year 3</p>
          <p>Growth Rate: 24% YoY</p>
        </div>
      )
    },
    {
      id: '2',
      title: 'Financial Projections',
      icon: <BarChart3 className="w-4 h-4" />,
      badge: 'Review',
      content: (
        <div className="space-y-2">
          <p>Year 1 Revenue: $500K</p>
          <p>Year 3 Revenue: $5M</p>
          <p>Break-even: Month 18</p>
        </div>
      )
    },
    {
      id: '3',
      title: 'Team Assessment',
      icon: <Trophy className="w-4 h-4" />,
      badge: 8,
      content: (
        <div className="space-y-2">
          <p>Core Team: 5 members</p>
          <p>Advisors: 3 industry experts</p>
          <p>Combined Experience: 45+ years</p>
        </div>
      )
    }
  ];

  const addToast = (type: ToastType) => {
    const messages = {
      success: { title: 'Achievement Unlocked!', message: 'You earned 250 XP' },
      error: { title: 'Upload Failed', message: 'File size exceeds limit' },
      warning: { title: 'Document Incomplete', message: 'Missing financial data' },
      info: { title: 'AI Analysis Ready', message: 'Score improved by +8 points' }
    };

    const newToast = {
      id: Date.now().toString(),
      type,
      ...messages[type]
    };

    setToasts(prev => [...prev, newToast]);
  };

  const removeToast = (id: string) => {
    setToasts(prev => prev.filter(toast => toast.id !== id));
  };

  return (
    <div className="p-6 space-y-8">
      <div className={`backdrop-blur-xl border rounded-2xl p-6 ${
        darkMode
          ? 'bg-gradient-to-br from-[#18181b]/80 to-[#27272a]/80 border-white/5'
          : 'bg-gradient-to-br from-white/80 to-gray-50/80 border-gray-200/50'
      }`}>
        <h2 className={`mb-6 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
          Component Library Showcase
        </h2>
        
        {/* Buttons Section */}
        <div className="mb-8">
          <h3 className={`text-sm mb-4 ${
            darkMode ? 'text-gray-400' : 'text-gray-600'
          }`}>
            Buttons
          </h3>
          
          <div className="space-y-4">
            {/* Primary Buttons */}
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary" size="sm" darkMode={darkMode}>
                Small Primary
              </Button>
              <Button variant="primary" size="md" darkMode={darkMode}>
                Medium Primary
              </Button>
              <Button variant="primary" size="lg" darkMode={darkMode}>
                Large Primary
              </Button>
              <Button variant="primary" darkMode={darkMode} disabled>
                Disabled
              </Button>
              <Button variant="primary" darkMode={darkMode} loading>
                Loading
              </Button>
            </div>
            
            {/* Secondary Buttons */}
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="secondary" darkMode={darkMode}>
                Secondary
              </Button>
              <Button variant="secondary" darkMode={darkMode} icon={<Plus className="w-4 h-4" />}>
                With Icon
              </Button>
              <Button variant="secondary" darkMode={darkMode} disabled>
                Disabled
              </Button>
            </div>
            
            {/* Ghost & Icon Buttons */}
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="ghost" darkMode={darkMode}>
                Ghost Button
              </Button>
              <Button variant="icon" darkMode={darkMode}>
                <Settings className="w-4 h-4" />
              </Button>
              <Button variant="icon" darkMode={darkMode}>
                <Download className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
        
        {/* Inputs Section */}
        <div className="mb-8">
          <h3 className={`text-sm mb-4 ${
            darkMode ? 'text-gray-400' : 'text-gray-600'
          }`}>
            Inputs
          </h3>
          
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Email"
              placeholder="Enter your email"
              type="email"
              darkMode={darkMode}
              leftIcon={<Mail className="w-4 h-4" />}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
            />
            
            <Input
              label="Password"
              placeholder="Enter password"
              type="password"
              darkMode={darkMode}
              leftIcon={<Lock className="w-4 h-4" />}
            />
            
            <Input
              label="Search"
              placeholder="Search deals..."
              darkMode={darkMode}
              leftIcon={<Search className="w-4 h-4" />}
              helperText="Search by name, type, or status"
            />
            
            <Input
              label="With Error"
              placeholder="Invalid input"
              darkMode={darkMode}
              error="This field is required"
            />
          </div>
        </div>
        
        {/* Textarea Section */}
        <div className="mb-8">
          <h3 className={`text-sm mb-4 ${
            darkMode ? 'text-gray-400' : 'text-gray-600'
          }`}>
            Textarea
          </h3>
          
          <div className="grid grid-cols-2 gap-4">
            <Textarea
              label="Description"
              placeholder="Enter description..."
              rows={4}
              darkMode={darkMode}
              helperText="Provide a detailed description"
              value={textareaValue}
              onChange={(e) => setTextareaValue(e.target.value)}
            />
            
            <Textarea
              label="Notes (with character count)"
              placeholder="Enter notes..."
              rows={4}
              darkMode={darkMode}
              showCharCount
              maxLength={200}
              value={textareaValue}
              onChange={(e) => setTextareaValue(e.target.value)}
            />
          </div>
        </div>
        
        {/* Select Section */}
        <div className="mb-8">
          <h3 className={`text-sm mb-4 ${
            darkMode ? 'text-gray-400' : 'text-gray-600'
          }`}>
            Select
          </h3>
          
          <div className="grid grid-cols-3 gap-4">
            <Select
              label="Deal Stage"
              darkMode={darkMode}
              value={selectValue}
              onChange={(e) => setSelectValue(e.target.value)}
              options={[
                { value: 'option1', label: 'Idea Stage' },
                { value: 'option2', label: 'In Progress' },
                { value: 'option3', label: 'Investor Ready' }
              ]}
            />
            
            <Select
              label="Priority"
              darkMode={darkMode}
              options={[
                { value: 'low', label: 'Low' },
                { value: 'medium', label: 'Medium' },
                { value: 'high', label: 'High' }
              ]}
            />
            
            <Select
              label="Disabled"
              darkMode={darkMode}
              disabled
              options={[
                { value: 'disabled', label: 'Disabled Option' }
              ]}
            />
          </div>
        </div>

        {/* Tabs Section */}
        <div className="mb-8">
          <h3 className={`text-sm mb-4 ${
            darkMode ? 'text-gray-400' : 'text-gray-600'
          }`}>
            Tabs
          </h3>
          
          <Tabs
            tabs={tabs}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            darkMode={darkMode}
          />
          
          <div className={`mt-4 p-4 rounded-lg ${
            darkMode ? 'bg-white/5' : 'bg-gray-100/50'
          }`}>
            <p className={darkMode ? 'text-gray-400' : 'text-gray-600'}>
              Content for {tabs.find(t => t.id === activeTab)?.label} tab
            </p>
          </div>
        </div>

        {/* Circular Progress Section */}
        <div className="mb-8">
          <h3 className={`text-sm mb-4 ${
            darkMode ? 'text-gray-400' : 'text-gray-600'
          }`}>
            Circular Progress
          </h3>
          
          <div className="flex items-center gap-8">
            <CircularProgress
              value={82}
              label="Investor Ready"
              darkMode={darkMode}
            />
            <CircularProgress
              value={2850}
              max={5000}
              label="XP Progress"
              darkMode={darkMode}
              size={100}
            />
            <CircularProgress
              value={65}
              label="Due Diligence"
              darkMode={darkMode}
              size={140}
              strokeWidth={10}
            />
          </div>
        </div>

        {/* Accordion Section */}
        <div className="mb-8">
          <h3 className={`text-sm mb-4 ${
            darkMode ? 'text-gray-400' : 'text-gray-600'
          }`}>
            Accordion
          </h3>
          
          <Accordion
            items={accordionItems}
            defaultOpenItems={['1']}
            allowMultiple={true}
            darkMode={darkMode}
          />
        </div>

        {/* Toast Notification Section */}
        <div className="mb-8">
          <h3 className={`text-sm mb-4 ${
            darkMode ? 'text-gray-400' : 'text-gray-600'
          }`}>
            Toast Notifications
          </h3>
          
          <div className="flex flex-wrap gap-3">
            <Button variant="primary" darkMode={darkMode} onClick={() => addToast('success')}>
              Show Success
            </Button>
            <Button variant="secondary" darkMode={darkMode} onClick={() => addToast('error')}>
              Show Error
            </Button>
            <Button variant="secondary" darkMode={darkMode} onClick={() => addToast('warning')}>
              Show Warning
            </Button>
            <Button variant="secondary" darkMode={darkMode} onClick={() => addToast('info')}>
              Show Info
            </Button>
          </div>
        </div>
        
        {/* Modal Section */}
        <div>
          <h3 className={`text-sm mb-4 ${
            darkMode ? 'text-gray-400' : 'text-gray-600'
          }`}>
            Modal
          </h3>
          
          <Button variant="primary" darkMode={darkMode} onClick={() => setShowModal(true)}>
            Open Modal
          </Button>
        </div>
      </div>
      
      {/* Modal Component */}
      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title="Example Modal"
        description="This is a modal component with glassmorphism"
        darkMode={darkMode}
        size="md"
        footer={
          <>
            <Button variant="ghost" darkMode={darkMode} onClick={() => setShowModal(false)}>
              Cancel
            </Button>
            <Button variant="primary" darkMode={darkMode} onClick={() => setShowModal(false)}>
              Confirm
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input
            label="Deal Name"
            placeholder="Enter deal name"
            darkMode={darkMode}
          />
          <Textarea
            label="Description"
            placeholder="Enter description..."
            rows={4}
            darkMode={darkMode}
          />
          <Select
            label="Stage"
            darkMode={darkMode}
            options={[
              { value: 'idea', label: 'Idea Stage' },
              { value: 'progress', label: 'In Progress' },
              { value: 'ready', label: 'Investor Ready' }
            ]}
          />
        </div>
      </Modal>

      {/* Toast Container */}
      <ToastContainer
        toasts={toasts}
        onClose={removeToast}
        darkMode={darkMode}
      />
    </div>
  );
}